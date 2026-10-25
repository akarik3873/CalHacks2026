"""Messages between the shopping agent and merchant agents. Payment itself uses Fetch.ai's AgentPaymentProtocol."""

from uagents import Model


class QuoteRequest(Model):
    request_id: str
    skus: list[str]


class QuoteLine(Model):
    sku: str
    price_cents: int
    stock: int


class Quote(Model):
    request_id: str
    merchant_id: str
    merchant_name: str
    delivery_minutes: int
    delivery_fee_cents: int
    lines: list[QuoteLine]


class OrderLine(Model):
    sku: str
    qty: int
    unit_price_cents: int


class PlaceOrder(Model):
    order_id: str
    lines: list[OrderLine]
    delivery_fee_cents: int


class OrderRejected(Model):
    order_id: str
    reason: str
