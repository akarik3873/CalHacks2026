"""Last checks before money moves. These run even though the planner already follows the same rules."""

from decimal import Decimal, InvalidOperation

from uagents_core.contrib.protocols.payment import RequestPayment

from .catalog import Kit, Product, fmt, matches
from .planner import Cart


class GuardrailError(Exception):
    pass


def dollars_to_cents(amount: str) -> int | None:
    try:
        cents = Decimal(amount) * 100
    except InvalidOperation:
        return None
    return int(cents) if cents == cents.to_integral_value() else None


def check_cart(cart: Cart, kit: Kit, catalog: dict[str, Product]) -> None:
    """No prescription items, only pre-approved products, and never over the budget cap."""
    rules = {item.key: item.match for item in kit.items}
    for line in cart.lines:
        product = catalog.get(line.sku)
        if product is None:
            raise GuardrailError(f"Unknown product {line.sku}")
        if product.rx:
            raise GuardrailError(f"{product.name} is prescription-only")
        if line.item_key not in rules or not matches(product, rules[line.item_key]):
            raise GuardrailError(f"{product.name} is not the product approved for {line.item_label}")
    if cart.budget_cap_cents > kit.budget_cap_cents:
        raise GuardrailError(f"Budget {fmt(cart.budget_cap_cents)} is above the profile cap {fmt(kit.budget_cap_cents)}")
    if cart.total_cents > cart.budget_cap_cents:
        raise GuardrailError(f"Total {fmt(cart.total_cents)} is over the {fmt(cart.budget_cap_cents)} budget")


def check_payment_request(
    request: RequestPayment, cart: Cart, merchant_id: str, merchant_address: str, order_id: str, already_paid_cents: int
) -> str | None:
    """Returns why the merchant's payment request must be rejected, or None if it matches what the user approved."""
    expected = cart.merchant_total_cents(merchant_id)
    if request.reference != order_id:
        return "payment request is for a different order"
    if request.recipient != merchant_address:
        return "payment recipient is not the merchant we ordered from"
    usd = [f for f in request.accepted_funds if f.currency == "USD"]
    if not usd:
        return "merchant doesn't accept USD"
    amount = dollars_to_cents(usd[0].amount)
    if amount != expected:
        return f"merchant asked for {usd[0].amount} USD but the approved amount is {fmt(expected)}"
    if already_paid_cents + amount > cart.budget_cap_cents:
        return f"paying this would go over the {fmt(cart.budget_cap_cents)} budget"
    return None
