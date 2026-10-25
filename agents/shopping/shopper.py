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
from .catalog import load_catalog, load_default_location, load_kits
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

APPROVE = re.compile(r"\b(approve|approved|confirm|yes|place (?:the )?order|go ahead|buy it)\b", re.IGNORECASE)
CANCEL = re.compile(r"\b(cancel|reject|stop|no|nope|don'?t)\b", re.IGNORECASE)

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
) -> Agent:
    """merchants maps merchant id -> agent address. model_call and air_lookup are swappable for offline tests."""
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

    # One pending cart per user, waiting for approval.
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
        decision = read_decision(text, waiting[0].id) if waiting else None

        if decision == "approve":
            cart, _, _ = pending.pop(sender)
            await checkout(ctx, sender, cart)
        elif decision == "cancel":
            pending.pop(sender)
            await ctx.send(sender, text_message("Cancelled. Nothing was ordered or charged.", end_session=True))
        else:
            await handle_request(ctx, sender, text)

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    async def handle_request(ctx: Context, sender: str, text: str):
        result, source = await understand_request(text, kits, catalog, model_call)
        ctx.logger.info(f"Request read by {source}: {type(result).__name__}")
        if isinstance(result, OrderIntent) and result.kit.key == "allergy":
            reading = await air_lookup(result.location or default_location)
            result = adjust_for_air_quality(result, reading, cited_bad_air=bool(CITES_BAD_AIR.search(text)))
        if isinstance(result, Emergency):
            await ctx.send(sender, text_message(result.message, end_session=True))
            return
        if isinstance(result, Refuse):
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

        check_cart(plan, kits[plan.kit_key], catalog)
        pending[sender] = (plan, result.rx_refused, time.monotonic())
        ctx.logger.info(f"Cart {plan.id} for {sender}: {plan.total_cents / 100:.2f} USD across {list(plan.merchants)}")
        await ctx.send(sender, review_message(plan, result.rx_refused))

    async def gather_quotes(ctx: Context, intent: OrderIntent) -> list[MerchantQuote]:
        skus = sorted({sku for item in intent.items for sku in approved_skus(item, catalog)})
        request = QuoteRequest(request_id=uuid4().hex, skus=skus)

        async def ask(address: str) -> MerchantQuote | None:
            reply, status = await ctx.send_and_receive(address, request, Quote, timeout=REPLY_TIMEOUT_SECONDS)
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
            lines = cart.lines_for(merchant_id)
            order = PlaceOrder(
                order_id=order_id,
                lines=[OrderLine(sku=l.sku, qty=l.qty, unit_price_cents=l.unit_price_cents) for l in lines],
                delivery_fee_cents=quote.delivery_fee_cents,
            )
            reply, _ = await ctx.send_and_receive(quote.address, order, {RequestPayment, OrderRejected}, timeout=REPLY_TIMEOUT_SECONDS)
            if not isinstance(reply, RequestPayment):
                reason = reply.reason if isinstance(reply, OrderRejected) else "merchant didn't respond"
                failed.append({"merchant": quote.name, "order_id": order_id, "reason": reason})
                continue

            problem = check_payment_request(reply, cart, merchant_id, quote.address, order_id, spent)
            if problem:
                await ctx.send(quote.address, RejectPayment(reason=problem))
                failed.append({"merchant": quote.name, "order_id": order_id, "reason": problem})
                continue

            amount = cart.merchant_total_cents(merchant_id)
            auth_id = network.authorize(amount, merchant_id, order_id)
            commit = CommitPayment(
                funds=Funds(amount=f"{amount / 100:.2f}", currency="USD", payment_method="card"),
                recipient=quote.address,
                transaction_id=auth_id,
                reference=order_id,
                description=f"{cart.kit_label} restock",
            )
            done, _ = await ctx.send_and_receive(quote.address, commit, {CompletePayment, CancelPayment}, timeout=REPLY_TIMEOUT_SECONDS)
            if isinstance(done, CompletePayment) and done.transaction_id == auth_id:
                spent += amount
                paid.append(
                    {
                        "merchant": quote.name,
                        "order_id": order_id,
                        "auth_id": auth_id,
                        "amount_cents": amount,
                        "eta_minutes": quote.delivery_minutes,
                        "items": [f"{l.product_name} ({l.qty}x)" for l in lines],
                    }
                )
            else:
                network.void(auth_id)
                reason = done.reason if isinstance(done, CancelPayment) and done.reason else "payment wasn't confirmed"
                failed.append({"merchant": quote.name, "order_id": order_id, "reason": reason})

        audit(sender, cart, paid, failed)
        await ctx.send(sender, receipt_message(cart, paid, failed, network.card_label))

    # Buyer side of AgentPaymentProtocol. Replies normally arrive through send_and_receive above;
    # these handlers only see late or unexpected messages.
    payments = Protocol(spec=payment_protocol_spec, role="buyer")

    @payments.on_message(RequestPayment)
    async def on_request_payment(ctx: Context, sender: str, msg: RequestPayment):
        ctx.logger.warning(f"Ignoring unexpected payment request {msg.reference} from {sender}")
        await ctx.send(sender, RejectPayment(reason="no matching approved order"))

    @payments.on_message(CompletePayment)
    async def on_complete(ctx: Context, sender: str, msg: CompletePayment):
        ctx.logger.info(f"Late payment completion {msg.transaction_id} from {sender}")

    @payments.on_message(CancelPayment)
    async def on_cancel(ctx: Context, sender: str, msg: CancelPayment):
        ctx.logger.info(f"Late payment cancellation {msg.transaction_id} from {sender}: {msg.reason}")

    agent.include(chat, publish_manifest=True)
    agent.include(payments, publish_manifest=True)
    return agent


def read_decision(text: str, cart_id: str) -> str | None:
    """Approve/cancel from a card click (JSON), a planner message naming the cart, or a short reply like 'yes'."""
    try:
        selection = json.loads(text)
    except ValueError:
        selection = None
    if isinstance(selection, dict) and selection.get("action") in ("approve", "cancel"):
        return selection["action"] if selection.get("cart_id") in (None, cart_id) else None
    if cart_id not in text and len(text.split()) > 6:
        return None  # a longer message is a new request, even if it contains "no"
    # Cancel wins when both appear: an ambiguous reply must never charge anyone.
    if CANCEL.search(text):
        return "cancel"
    if APPROVE.search(text):
        return "approve"
    return None


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
