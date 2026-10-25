"""A simulated pharmacy/delivery merchant as a uAgent: quotes prices and stock, holds stock for an order, and gets paid
through AgentPaymentProtocol as the seller."""

import time
from dataclasses import dataclass

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


@dataclass
class Reservation:
    payer: str
    lines: dict[str, int]  # sku -> qty
    amount_cents: int
    expires_at: float


def create_merchant(info: MerchantInfo, catalog: dict[str, Product], network: SimulatedCardNetwork, seed: str) -> Agent:
    agent = Agent(name=info.name, seed=seed, description=f"Simulated health supply merchant: {info.name}")

    prices = {sku: round(p.list_price_cents * info.price_factor) for sku, p in catalog.items() if sku not in info.not_carried}
    stock = {sku: 0 if sku in info.out_of_stock else info.stock for sku in prices}
    held: dict[str, int] = {sku: 0 for sku in prices}
    reservations: dict[str, Reservation] = {}
    finished: set[str] = set()

    def available(sku: str) -> int:
        return stock.get(sku, 0) - held.get(sku, 0)

    def release(order_id: str) -> None:
        reservation = reservations.pop(order_id, None)
        if reservation:
            for sku, qty in reservation.lines.items():
                held[sku] -= qty

    shop = Protocol(name="HealthSupplyMerchant", version="0.1.0")

    @shop.on_message(QuoteRequest)
    async def on_quote(ctx: Context, sender: str, msg: QuoteRequest):
        lines = [QuoteLine(sku=sku, price_cents=prices[sku], stock=available(sku)) for sku in msg.skus if sku in prices]
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
        if msg.order_id in reservations or msg.order_id in finished:
            problem = "duplicate order id"
        elif msg.delivery_fee_cents != info.delivery_fee_cents:
            problem = "delivery fee changed"
        for line in msg.lines:
            if problem:
                break
            if line.sku not in prices:
                problem = f"{line.sku} isn't sold here"
            elif catalog[line.sku].rx:
                problem = f"{catalog[line.sku].name} needs a prescription"
            elif line.unit_price_cents != prices[line.sku]:
                problem = f"price of {catalog[line.sku].name} changed"
            elif line.qty < 1 or available(line.sku) < line.qty:
                problem = f"{catalog[line.sku].name} is out of stock"
        if problem:
            ctx.logger.info(f"Rejected order {msg.order_id}: {problem}")
            await ctx.send(sender, OrderRejected(order_id=msg.order_id, reason=problem))
            return

        amount = sum(line.unit_price_cents * line.qty for line in msg.lines) + info.delivery_fee_cents
        for line in msg.lines:
            held[line.sku] += line.qty
        reservations[msg.order_id] = Reservation(
            payer=sender,
            lines={line.sku: line.qty for line in msg.lines},
            amount_cents=amount,
            expires_at=time.monotonic() + PAYMENT_DEADLINE_SECONDS,
        )
        await ctx.send(
            sender,
            RequestPayment(
                accepted_funds=[Funds(amount=f"{amount / 100:.2f}", currency="USD", payment_method="card")],
                recipient=ctx.agent.address,
                deadline_seconds=PAYMENT_DEADLINE_SECONDS,
                reference=msg.order_id,
                description=f"{info.name} order {msg.order_id}",
            ),
        )

    payments = Protocol(spec=payment_protocol_spec, role="seller")

    @payments.on_message(CommitPayment)
    async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
        reservation = reservations.get(msg.reference or "")
        amount = dollars_to_cents(msg.funds.amount)
        verified = (
            reservation is not None
            and reservation.payer == sender
            and msg.recipient == ctx.agent.address
            and msg.funds.currency == "USD"
            and amount == reservation.amount_cents
            and network.verify(msg.transaction_id, reservation.amount_cents, info.id, msg.reference or "")
        )
        if not verified:
            release(msg.reference or "")
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason="payment could not be verified"))
            return

        network.capture(msg.transaction_id)
        for sku, qty in reservation.lines.items():
            held[sku] -= qty
            stock[sku] -= qty
        del reservations[msg.reference]
        finished.add(msg.reference)
        ctx.logger.info(f"Paid order {msg.reference}: {amount / 100:.2f} USD, {msg.transaction_id}")
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))

    @payments.on_message(RejectPayment)
    async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
        # RejectPayment carries no order reference, so release everything this buyer is holding.
        for order_id in [o for o, r in reservations.items() if r.payer == sender]:
            release(order_id)
        ctx.logger.info(f"Buyer rejected payment: {msg.reason}")

    @agent.on_interval(period=30.0)
    async def expire_holds(ctx: Context):
        now = time.monotonic()
        for order_id in [o for o, r in reservations.items() if r.expires_at < now]:
            release(order_id)
            ctx.logger.info(f"Released stock for unpaid order {order_id}")

    agent.include(shop)
    agent.include(payments)
    return agent
