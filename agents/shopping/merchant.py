"""A simulated pharmacy/delivery merchant as a uAgent: quotes prices and stock, holds stock for an order, and gets paid
through AgentPaymentProtocol as the seller."""

import time
from dataclasses import dataclass, field

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from .catalog import MerchantInfo, Product
from .guardrails import dollars_to_cents
from .models import OrderRejected, PlaceOrder, Quote, QuoteLine, QuoteRequest
from .payments import SimulatedCardNetwork

PAYMENT_DEADLINE_SECONDS = 300
RESTOCK_SECONDS = 3600  # simulated merchants refill to their starting stock every hour, so demos stay repeatable


@dataclass
class Reservation:
    payer: str
    lines: dict[str, int]  # sku -> qty
    amount_cents: int
    expires_at: float


@dataclass
class MerchantBook:
    """A merchant's prices and stock. Exposed as agent.book so tests can change prices or stock mid-order."""

    prices: dict[str, int]
    stock: dict[str, int]
    starting_stock: dict[str, int]
    held: dict[str, int]
    reservations: dict[str, Reservation] = field(default_factory=dict)
    finished: set[str] = field(default_factory=set)
    # Simulated failure modes, for testing how the shopper copes: "no_quotes", "inflate_payment", "drop_confirmation".
    fault: str | None = None

    def available(self, sku: str) -> int:
        return self.stock.get(sku, 0) - self.held.get(sku, 0)

    def release(self, order_id: str) -> None:
        reservation = self.reservations.pop(order_id, None)
        if reservation:
            for sku, qty in reservation.lines.items():
                self.held[sku] -= qty


def create_merchant(info: MerchantInfo, catalog: dict[str, Product], network: SimulatedCardNetwork, seed: str) -> Agent:
    agent = Agent(name=info.name, seed=seed, description=f"Simulated health supply merchant: {info.name}")

    prices = {sku: round(p.list_price_cents * info.price_factor) for sku, p in catalog.items() if sku not in info.not_carried}
    stock = {sku: 0 if sku in info.out_of_stock else info.stock for sku in prices}
    book = MerchantBook(prices=prices, stock=stock, starting_stock=dict(stock), held={sku: 0 for sku in prices})
    agent.book = book

    shop = Protocol(name="HealthSupplyMerchant", version="0.1.0")

    @shop.on_message(QuoteRequest)
    async def on_quote(ctx: Context, sender: str, msg: QuoteRequest):
        if book.fault == "no_quotes":
            return
        lines = [QuoteLine(sku=sku, price_cents=book.prices[sku], stock=book.available(sku)) for sku in msg.skus if sku in book.prices]
        await ctx.send(
            sender,
            Quote(
                request_id=msg.request_id,
                merchant_id=info.id,
                merchant_name=info.name,
                delivery_minutes=info.delivery_minutes,
                delivery_fee_cents=info.delivery_fee_cents,
                lines=lines,
            ),
        )

    @shop.on_message(PlaceOrder)
    async def on_order(ctx: Context, sender: str, msg: PlaceOrder):
        problem = None
        if msg.order_id in book.reservations or msg.order_id in book.finished:
            problem = "duplicate order id"
        elif not msg.lines:
            problem = "empty order"
        elif msg.delivery_fee_cents != info.delivery_fee_cents:
            problem = "delivery fee changed"
        for line in msg.lines:
            if problem:
                break
            if line.sku not in book.prices:
                problem = f"{line.sku} isn't sold here"
            elif catalog[line.sku].rx:
                problem = f"{catalog[line.sku].name} needs a prescription"
            elif line.unit_price_cents != book.prices[line.sku]:
                problem = f"the price of {catalog[line.sku].name} changed"
            elif line.qty < 1 or book.available(line.sku) < line.qty:
                problem = f"{catalog[line.sku].name} is out of stock"
        if problem:
            ctx.logger.info(f"Rejected order {msg.order_id}: {problem}")
            await ctx.send(sender, OrderRejected(order_id=msg.order_id, reason=problem))
            return

        amount = sum(line.unit_price_cents * line.qty for line in msg.lines) + info.delivery_fee_cents
        for line in msg.lines:
            book.held[line.sku] += line.qty
        book.reservations[msg.order_id] = Reservation(
            payer=sender,
            lines={line.sku: line.qty for line in msg.lines},
            amount_cents=amount,
            expires_at=time.monotonic() + PAYMENT_DEADLINE_SECONDS,
        )
        asked = amount + 100 if book.fault == "inflate_payment" else amount
        await ctx.send(
            sender,
            RequestPayment(
                accepted_funds=[Funds(amount=f"{asked / 100:.2f}", currency="USD", payment_method="card")],
                recipient=ctx.agent.address,
                deadline_seconds=PAYMENT_DEADLINE_SECONDS,
                reference=msg.order_id,
                description=f"{info.name} order {msg.order_id}",
            ),
        )

    payments = Protocol(spec=payment_protocol_spec, role="seller")

    @payments.on_message(CommitPayment)
    async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
        order_id = msg.reference or ""
        reservation = book.reservations.get(order_id)
        amount = dollars_to_cents(msg.funds.amount)
        verified = (
            reservation is not None
            and reservation.payer == sender
            and msg.recipient == ctx.agent.address
            and msg.funds.currency == "USD"
            and amount == reservation.amount_cents
            and network.verify(msg.transaction_id, reservation.amount_cents, info.id, order_id)
        )
        if not verified:
            if reservation is not None and reservation.payer == sender:
                book.release(order_id)
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="the payment could not be verified"))
            return

        network.capture(msg.transaction_id)
        for sku, qty in reservation.lines.items():
            book.held[sku] -= qty
            book.stock[sku] -= qty
        del book.reservations[order_id]
        book.finished.add(order_id)
        ctx.logger.info(f"Paid order {order_id}: {amount / 100:.2f} USD, {msg.transaction_id}")
        if book.fault == "drop_confirmation":
            return
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))

    @payments.on_message(RejectPayment)
    async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
        # RejectPayment has no order field, so the shopper puts the order id first in the reason ("<order_id>: why").
        order_id = (msg.reason or "").split(":", 1)[0].strip()
        reservation = book.reservations.get(order_id)
        if reservation and reservation.payer == sender:
            book.release(order_id)
        ctx.logger.info(f"Buyer rejected payment: {msg.reason}")

    @agent.on_interval(period=30.0)
    async def expire_holds(ctx: Context):
        now = time.monotonic()
        for order_id in [o for o, r in book.reservations.items() if r.expires_at < now]:
            book.release(order_id)
            ctx.logger.info(f"Released stock for unpaid order {order_id}")

    @agent.on_interval(period=RESTOCK_SECONDS)
    async def restock(ctx: Context):
        for sku, starting in book.starting_stock.items():
            book.stock[sku] = max(book.stock[sku], starting)

    agent.include(shop)
    agent.include(payments)
    return agent
