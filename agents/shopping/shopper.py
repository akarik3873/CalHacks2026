"""The shopping agent people talk to in ASI:One.

Flow: chat request -> structured intent -> quotes from every merchant agent -> cheapest cart within the rules ->
review card -> user approves -> AgentPaymentProtocol checkout with each merchant (as buyer) -> receipt."""

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, chat_protocol_spec
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from .airquality import CITES_BAD_AIR, AirLookup, adjust_for_air_quality, fetch_air_quality
from .catalog import fmt, load_catalog, load_default_location, load_kits
from .guardrails import GuardrailError, check_cart, check_payment_request
from .intent import Clarify, Emergency, OrderIntent, Refuse
from .messages import receipt_message, review_message, text_message
from .models import OrderLine, OrderRejected, PlaceOrder, Quote, QuoteRequest
from .payments import SimulatedCardNetwork
from .planner import Cart, MerchantQuote, NoCart, approved_skus, plan_cart
from .understanding import ModelCall, call_asi_one, understand_request

AGENTS_DIR = Path(__file__).resolve().parent.parent
AUDIT_LOG = AGENTS_DIR / ".state" / "audit.jsonl"
REPLY_TIMEOUT_SECONDS = 20
CART_TTL_SECONDS = 15 * 60

APPROVE = re.compile(
    r"\b(approve|approved|confirm|confirmed|yes|yep|yeah|sure|ok|okay|sounds good|do it|go ahead|place (?:the )?order|buy it|check ?out)\b",
    re.IGNORECASE,
)
CANCEL = re.compile(r"\b(cancel|cancelled|reject|stop|no|nope|don'?t|never ?mind|forget it)\b", re.IGNORECASE)
# Words that make a short message a new request rather than an answer to the waiting order.
NEW_REQUEST = re.compile(r"\b(restock|need|running (?:out|low)|out of|get me|order my|instead)\b", re.IGNORECASE)

NOTHING_WAITING = (
    "There's no order waiting for your approval (it may have already been handled, or expired after 15 minutes). "
    "Nothing was charged. Tell me what you need and I'll get fresh prices."
)
STALE_CARD = "That card is for an older order, so I ignored it. Nothing was charged. Your latest order is still waiting for approval."

DESCRIPTION = (
    "Restocks over-the-counter health supplies (diabetes care, allergy and air quality, post-surgery recovery, period care). "
    "Compares price, stock, and delivery time across merchants, then pays only after you approve. "
    "Never buys prescription items, never substitutes products, never goes over your budget."
)


def create_shopper(
    seed: str,
    merchants: dict[str, str],
    network: SimulatedCardNetwork,
    *,
    mailbox: bool,
    port: int | None = None,
    readme: bool = True,
    model_call: ModelCall = call_asi_one,
    air_lookup: AirLookup = fetch_air_quality,
    reply_timeout: float = REPLY_TIMEOUT_SECONDS,
) -> Agent:
    """merchants maps merchant id -> agent address. model_call, air_lookup, and reply_timeout are swappable for offline tests."""
    catalog = load_catalog()
    kits = load_kits()
    default_location = load_default_location()
    agent = Agent(
        name="Health Supply Shopper",
        seed=seed,
        port=port,
        mailbox=mailbox,
        publish_agent_details=mailbox,
        description=DESCRIPTION,
        readme_path=str(AGENTS_DIR / "README.md") if readme else None,
    )

    # One pending cart per user, waiting for approval: (cart, prescription items refused, created at).
    pending: dict[str, tuple[Cart, list[str], float]] = {}

    chat = Protocol(spec=chat_protocol_spec)

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        text = msg.text().strip()
        if not text:
            return

        waiting = pending.get(sender)
        if waiting and time.monotonic() - waiting[2] > CART_TTL_SECONDS:
            pending.pop(sender)
            waiting = None
        decision = read_decision(text, waiting[0] if waiting else None)

        try:
            if decision == "approve" and waiting:
                pending.pop(sender)
                await checkout(ctx, sender, waiting[0])
            elif decision == "cancel" and waiting:
                pending.pop(sender)
                await ctx.send(sender, text_message("Cancelled. Nothing was ordered or charged.", end_session=True))
            elif decision == "stale":
                await ctx.send(sender, text_message(STALE_CARD if waiting else NOTHING_WAITING, end_session=not waiting))
            elif decision in ("approve", "cancel"):
                await ctx.send(sender, text_message(NOTHING_WAITING, end_session=True))
            else:
                await handle_request(ctx, sender, text)
        except Exception:
            ctx.logger.exception(f"Failed handling a message from {sender}")
            await ctx.send(
                sender,
                text_message(
                    "Sorry, something went wrong on my side and I stopped. "
                    "If you had approved an order, check for a receipt before trying again.",
                    end_session=True,
                ),
            )

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    async def handle_request(ctx: Context, sender: str, text: str):
        result, source = await understand_request(text, kits, catalog, model_call)
        ctx.logger.info(f"Request read by {source}: {type(result).__name__}")
        if isinstance(result, OrderIntent) and result.kit.key == "allergy":
            reading = await air_lookup(result.location or default_location)
            result = adjust_for_air_quality(result, reading, cited_bad_air=bool(CITES_BAD_AIR.search(text)))
        if isinstance(result, (Emergency, Refuse)):
            await ctx.send(sender, text_message(result.message, end_session=True))
            return
        if isinstance(result, Clarify):
            await ctx.send(sender, text_message(result.message))
            return

        quotes = await gather_quotes(ctx, result)
        if not quotes:
            await ctx.send(sender, text_message("I couldn't reach any merchants just now. Please try again in a minute.", end_session=True))
            return

        plan = plan_cart(result, catalog, quotes)
        if isinstance(plan, NoCart):
            extra = [f"Not ordered (prescription only): {', '.join(dict.fromkeys(result.rx_refused))}."] if result.rx_refused else []
            await ctx.send(sender, text_message("\n".join([plan.message, *result.notes, *extra]), end_session=True))
            return

        try:
            check_cart(plan, kits[plan.kit_key], catalog)
        except GuardrailError as error:
            ctx.logger.error(f"Planner produced a cart that fails the guardrails: {error}")
            await ctx.send(sender, text_message(f"I couldn't build an order that follows your rules ({error}). Nothing was charged.", end_session=True))
            return
        pending[sender] = (plan, result.rx_refused, time.monotonic())
        ctx.logger.info(f"Cart {plan.id} for {sender}: {plan.total_cents / 100:.2f} USD across {list(plan.merchants)}")
        await ctx.send(sender, review_message(plan, result.rx_refused))

    async def gather_quotes(ctx: Context, intent: OrderIntent) -> list[MerchantQuote]:
        skus = sorted({sku for item in intent.items for sku in approved_skus(item, catalog)})
        request = QuoteRequest(request_id=uuid4().hex, skus=skus)

        async def ask(address: str) -> MerchantQuote | None:
            reply, status = await ctx.send_and_receive(address, request, Quote, timeout=reply_timeout)
            if not isinstance(reply, Quote) or reply.request_id != request.request_id:
                ctx.logger.warning(f"No quote from {address}: {status.detail}")
                return None
            return MerchantQuote(
                merchant_id=reply.merchant_id,
                name=reply.merchant_name,
                address=address,
                delivery_fee_cents=reply.delivery_fee_cents,
                delivery_minutes=reply.delivery_minutes,
                offers={line.sku: (line.price_cents, line.stock) for line in reply.lines},
            )

        results = await asyncio.gather(*(ask(address) for address in merchants.values()))
        return [q for q in results if q is not None]

    async def checkout(ctx: Context, sender: str, cart: Cart):
        try:
            check_cart(cart, kits[cart.kit_key], catalog)
        except GuardrailError as error:
            await ctx.send(sender, text_message(f"I stopped before paying: {error}. Nothing was charged.", end_session=True))
            return

        paid, failed, spent = [], [], 0
        for merchant_id, quote in cart.merchants.items():
            order_id = f"{cart.id}-{merchant_id}"
            try:
                outcome = await pay_merchant(ctx, cart, merchant_id, quote, order_id, spent)
            except Exception:
                ctx.logger.exception(f"Checkout with {quote.name} failed")
                outcome = {"merchant": quote.name, "order_id": order_id, "reason": "an unexpected error stopped this order"}
            if "auth_id" in outcome:
                spent += outcome["amount_cents"]
                paid.append(outcome)
            else:
                failed.append(outcome)

        try:
            audit(sender, cart, paid, failed)
        except OSError:
            ctx.logger.exception("Couldn't write the audit log")
        await ctx.send(sender, receipt_message(cart, paid, failed, network.card_label))

    async def pay_merchant(ctx: Context, cart: Cart, merchant_id: str, quote: MerchantQuote, order_id: str, spent: int) -> dict:
        """Places one merchant's part of the order and pays for it. Returns a paid entry (with auth_id) or a failed one."""
        lines = cart.lines_for(merchant_id)
        failure = {"merchant": quote.name, "order_id": order_id}
        order = PlaceOrder(
            order_id=order_id,
            lines=[OrderLine(sku=l.sku, qty=l.qty, unit_price_cents=l.unit_price_cents) for l in lines],
            delivery_fee_cents=quote.delivery_fee_cents,
        )
        reply, _ = await ctx.send_and_receive(quote.address, order, {RequestPayment, OrderRejected}, timeout=reply_timeout)
        if not isinstance(reply, RequestPayment):
            return {**failure, "reason": reply.reason if isinstance(reply, OrderRejected) else "the merchant didn't respond"}

        problem = check_payment_request(reply, cart, merchant_id, quote.address, order_id, spent)
        if problem:
            # The order id goes first so the merchant releases only this order's stock.
            await ctx.send(quote.address, RejectPayment(reason=f"{order_id}: {problem}"))
            return {**failure, "reason": problem}

        amount = cart.merchant_total_cents(merchant_id)
        auth_id = network.authorize(amount, merchant_id, order_id)
        commit = CommitPayment(
            funds=Funds(amount=f"{amount / 100:.2f}", currency="USD", payment_method="card"),
            recipient=quote.address,
            transaction_id=auth_id,
            reference=order_id,
            description=f"{cart.kit_label} restock",
        )
        done, _ = await ctx.send_and_receive(quote.address, commit, {CompletePayment, CancelPayment}, timeout=reply_timeout)
        confirmed = isinstance(done, CompletePayment) and done.transaction_id == auth_id
        # If the merchant's confirmation was lost, ask the card network what actually happened before reporting.
        if not confirmed and network.status(auth_id) == "captured":
            ctx.logger.warning(f"No confirmation from {quote.name} for {order_id}, but the card network shows it captured")
            confirmed = True
        if not confirmed:
            network.void(auth_id)
            reason = done.reason if isinstance(done, CancelPayment) and done.reason else "the payment wasn't confirmed"
            return {**failure, "reason": reason}
        return {
            "merchant": quote.name,
            "order_id": order_id,
            "auth_id": auth_id,
            "amount_cents": amount,
            "eta_minutes": quote.delivery_minutes,
            "items": [f"{l.product_name} ({l.qty}x)" for l in lines],
        }

    # Buyer side of AgentPaymentProtocol. Replies normally arrive through send_and_receive above;
    # these handlers only see late or unexpected messages.
    payments = Protocol(spec=payment_protocol_spec, role="buyer")

    @payments.on_message(RequestPayment)
    async def on_request_payment(ctx: Context, sender: str, msg: RequestPayment):
        ctx.logger.warning(f"Rejecting unexpected payment request {msg.reference} from {sender}")
        await ctx.send(sender, RejectPayment(reason=f"{msg.reference}: no matching approved order"))

    @payments.on_message(CompletePayment)
    async def on_complete(ctx: Context, sender: str, msg: CompletePayment):
        ctx.logger.info(f"Late payment completion {msg.transaction_id} from {sender}")

    @payments.on_message(CancelPayment)
    async def on_cancel(ctx: Context, sender: str, msg: CancelPayment):
        ctx.logger.info(f"Late payment cancellation {msg.transaction_id} from {sender}: {msg.reason}")

    agent.include(chat, publish_manifest=True)
    agent.include(payments, publish_manifest=True)
    return agent


def read_decision(text: str, cart: Cart | None) -> str | None:
    """"approve", "cancel", "stale" (a card click for a different order), or None (a new request).

    Accepts a card click (JSON), a planner message that names the order, or a short reply like "yes". Questions and
    messages that ask for something new are never treated as approval."""
    try:
        selection = json.loads(text)
    except ValueError:
        selection = None
    if isinstance(selection, dict) and selection.get("action") in ("approve", "cancel"):
        if cart and selection.get("cart_id") in (None, cart.id):
            return selection["action"]
        return "stale" if selection.get("cart_id") else selection["action"]

    has_cancel, has_approve = bool(CANCEL.search(text)), bool(APPROVE.search(text))
    if not (has_cancel or has_approve) or "?" in text:
        return None
    names_cart = cart is not None and (cart.id in text or fmt(cart.total_cents) in text)
    short_answer = len(text.split()) <= 8 and not NEW_REQUEST.search(text)
    if not (names_cart or short_answer):
        return None
    # Cancel wins when both appear: an ambiguous reply must never charge anyone.
    return "cancel" if has_cancel else "approve"


def audit(user: str, cart: Cart, paid: list[dict], failed: list[dict]) -> None:
    AUDIT_LOG.parent.mkdir(exist_ok=True)
    entry = {
        "time": datetime.now(timezone.utc).isoformat(),
        "user": user,
        "cart_id": cart.id,
        "kit": cart.kit_key,
        "budget_cap_cents": cart.budget_cap_cents,
        "paid": paid,
        "failed": failed,
    }
    with AUDIT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
