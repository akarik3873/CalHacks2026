"""Picks the cheapest cart that meets the user's rules: approved products only, in stock, delivered in time, under budget."""

from dataclasses import dataclass, field
from itertools import combinations
from uuid import uuid4

from .catalog import KitItem, Product, fmt, matches
from .intent import URGENCY_MAX_MINUTES, OrderIntent


@dataclass(frozen=True)
class MerchantQuote:
    merchant_id: str
    name: str
    address: str
    delivery_fee_cents: int
    delivery_minutes: int
    # sku -> (price in cents, units in stock)
    offers: dict[str, tuple[int, int]]


@dataclass(frozen=True)
class CartLine:
    item_key: str
    item_label: str
    sku: str
    product_name: str
    qty: int
    unit_price_cents: int
    merchant_id: str

    @property
    def total_cents(self) -> int:
        return self.unit_price_cents * self.qty


@dataclass
class Cart:
    id: str
    kit_key: str
    kit_label: str
    urgency: str
    budget_cap_cents: int
    lines: list[CartLine]
    merchants: dict[str, MerchantQuote]
    dropped: list[str] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    # merchant name -> what the same items would cost from that merchant alone, for every merchant that has them all in time
    single_store_totals: dict[str, int] = field(default_factory=dict)

    def lines_for(self, merchant_id: str) -> list[CartLine]:
        return [line for line in self.lines if line.merchant_id == merchant_id]

    def merchant_total_cents(self, merchant_id: str) -> int:
        return sum(line.total_cents for line in self.lines_for(merchant_id)) + self.merchants[merchant_id].delivery_fee_cents

    @property
    def total_cents(self) -> int:
        return sum(self.merchant_total_cents(m) for m in self.merchants)

    @property
    def eta_minutes(self) -> int:
        return max(m.delivery_minutes for m in self.merchants.values())


@dataclass
class NoCart:
    message: str


Option = tuple[MerchantQuote, str, int]  # merchant, sku, unit price in cents


def approved_skus(item: KitItem, catalog: dict[str, Product]) -> list[str]:
    """The only products this item may be filled with. Prescription products never qualify."""
    return [p.sku for p in catalog.values() if not p.rx and matches(p, item.match)]


def plan_cart(intent: OrderIntent, catalog: dict[str, Product], quotes: list[MerchantQuote]) -> Cart | NoCart:
    max_minutes = URGENCY_MAX_MINUTES[intent.urgency]
    fast_enough = [q for q in quotes if q.delivery_minutes <= max_minutes]

    candidates: dict[str, list[Option]] = {}
    unavailable = []
    for item in intent.items:
        options = [
            (q, sku, q.offers[sku][0])
            for q in fast_enough
            for sku in approved_skus(item, catalog)
            if sku in q.offers and q.offers[sku][1] >= item.qty
        ]
        if options:
            candidates[item.key] = options
        else:
            unavailable.append(item.label)

    active = [i for i in intent.items if i.key in candidates]
    if not active:
        return NoCart("None of the approved items are in stock with delivery that fast. Try a later delivery time.")

    # Drop optional items from the bottom of the priority list until the order fits the budget.
    dropped = []
    lines, merchants = _cheapest(active, candidates, catalog)
    while _total(lines, merchants) > intent.budget_cap_cents:
        optional = [i for i in active if not i.essential]
        if not optional or len(active) == 1:
            return NoCart(
                f"The cheapest order I can build comes to {fmt(_total(lines, merchants))}, over your {fmt(intent.budget_cap_cents)} limit, "
                "so I didn't place it. Raise the budget or ask for fewer items."
            )
        active.remove(optional[-1])
        dropped.append(optional[-1].label)
        lines, merchants = _cheapest(active, candidates, catalog)

    return Cart(
        id=uuid4().hex[:8],
        kit_key=intent.kit.key,
        kit_label=intent.kit.label,
        urgency=intent.urgency,
        budget_cap_cents=intent.budget_cap_cents,
        lines=lines,
        merchants=merchants,
        dropped=dropped,
        unavailable=unavailable,
        notes=list(intent.notes),
        single_store_totals=_single_store_totals(active, candidates, catalog),
    )


def _total(lines: list[CartLine], merchants: dict[str, MerchantQuote]) -> int:
    return sum(line.total_cents for line in lines) + sum(m.delivery_fee_cents for m in merchants.values())


def _cheapest(
    items: list[KitItem], candidates: dict[str, list[Option]], catalog: dict[str, Product]
) -> tuple[list[CartLine], dict[str, MerchantQuote]]:
    """Tries every set of merchants and keeps the lowest total, counting delivery fees; ties go to fewer, faster merchants."""
    all_merchants = _merchants(candidates)
    best, best_key = None, None
    for size in range(1, len(all_merchants) + 1):
        for subset in combinations(sorted(all_merchants), size):
            lines = _fill(items, candidates, catalog, set(subset))
            if lines is None:
                continue
            used = {line.merchant_id: all_merchants[line.merchant_id] for line in lines}
            key = (_total(lines, used), len(used), max(m.delivery_minutes for m in used.values()))
            if best_key is None or key < best_key:
                best, best_key = (lines, used), key
    assert best is not None, "every active item has at least one option"
    return best


def _single_store_totals(items: list[KitItem], candidates: dict[str, list[Option]], catalog: dict[str, Product]) -> dict[str, int]:
    """What the order would cost from each merchant on its own, so the review can say what the chosen order saves."""
    totals = {}
    for merchant_id, quote in _merchants(candidates).items():
        lines = _fill(items, candidates, catalog, {merchant_id})
        if lines is not None:
            totals[quote.name] = _total(lines, {merchant_id: quote})
    return totals


def _merchants(candidates: dict[str, list[Option]]) -> dict[str, MerchantQuote]:
    return {q.merchant_id: q for options in candidates.values() for q, _, _ in options}


def _fill(items: list[KitItem], candidates: dict[str, list[Option]], catalog: dict[str, Product], merchant_ids: set[str]) -> list[CartLine] | None:
    """The cheapest line for each item using only these merchants, or None if one of them can't supply an item."""
    lines = []
    for item in items:
        options = [o for o in candidates[item.key] if o[0].merchant_id in merchant_ids]
        if not options:
            return None
        q, sku, price = min(options, key=lambda o: (o[2], o[0].delivery_minutes, o[1]))
        lines.append(CartLine(item.key, item.label, sku, catalog[sku].name, item.qty, price, q.merchant_id))
    return lines
