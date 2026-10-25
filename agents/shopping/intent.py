"""Turns a chat request into a structured order intent. Deterministic on purpose: the agent never guesses at products."""

import re
from dataclasses import dataclass, field

from .catalog import Kit, KitItem, Product, fmt, matches, to_cents

URGENCY_MAX_MINUTES = {"asap": 120, "today": 720, "standard": 4320}
URGENCY_LABEL = {"asap": "within 2 hours", "today": "today", "standard": "within 3 days"}

EMERGENCY = re.compile(
    r"chest pain|can'?t breathe|cannot breathe|trouble breathing|not breathing|passed out|fainted|unconscious|"
    r"unresponsive|seizure|anaphyla|throat (?:is )?(?:closing|swelling)|severe (?:allergic )?reaction|suicid|overdos",
    re.IGNORECASE,
)
EMERGENCY_REPLY = (
    "This sounds like it could be an emergency, and a delivery won't arrive fast enough. "
    "Please call 911 (or your local emergency number) now. For low blood sugar, use the fast-acting glucose you have on hand "
    "and follow your care plan. I haven't ordered anything."
)

# Prescription-only items people may ask for that aren't in the catalog. Catalog Rx items are detected by their own keywords.
RX_TERMS = ("insulin", "antibiotic", "amoxicillin", "ozempic", "wegovy", "metformin", "epipen", "epinephrine", "adderall", "xanax")

ASAP_WORDS = ("asap", "urgent", "right away", "right now", "immediately", "within an hour", "in an hour", "as soon as possible")
TODAY_WORDS = ("today", "tonight", "this evening", "this afternoon", "same day", "same-day")
WHOLE_KIT_WORDS = ("kit", "everything", "restock", "usual", "supplies", "all my")
AMOUNT = r"(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?"  # 1,000 or 1000, optional cents
BUDGET_PATTERNS = (
    re.compile(r"\$\s*" + AMOUNT),
    re.compile(r"\b" + AMOUNT + r"\s*(?:dollars|usd|bucks)\b", re.IGNORECASE),
)


@dataclass
class OrderIntent:
    kit: Kit
    items: list[KitItem]
    budget_cap_cents: int
    urgency: str
    urgency_stated: bool = False
    rx_refused: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    location: str | None = None


@dataclass
class Clarify:
    message: str


@dataclass
class Emergency:
    message: str = EMERGENCY_REPLY


@dataclass
class Refuse:
    message: str


def _has(text: str, words) -> bool:
    return any(w in text for w in words)


def _kit_menu(kits: dict[str, Kit]) -> str:
    names = ", ".join(k.label for k in kits.values())
    return (
        f"I can restock these kits: {names}. Tell me what you need, how soon, and a budget, "
        'e.g. "Pollen is spiking, restock my allergy kit today, under $50."'
    )


@dataclass
class Signals:
    """What a request asks for, read either by the keyword rules or by the ASI:One model. Not trusted on its own:
    build_intent re-applies every safety rule to the raw text."""

    kit_key: str | None
    item_keys: list[str] = field(default_factory=list)  # items the user named
    whole_kit: bool = False
    budget_cents: int | None = None
    urgency: str | None = None  # None = not stated
    rx_requested: list[str] = field(default_factory=list)
    emergency: bool = False
    location: str | None = None
    source: str = "rules"


def parse_request(text: str, kits: dict[str, Kit], catalog: dict[str, Product]) -> OrderIntent | Clarify | Emergency | Refuse:
    return build_intent(text, rule_signals(text, kits, catalog), kits, catalog)


def rule_signals(text: str, kits: dict[str, Kit], catalog: dict[str, Product]) -> Signals:
    lowered = text.lower()
    rx_products = _rx_products_in(lowered, catalog)

    scores = {}
    for kit in kits.values():
        score = sum(kw in lowered for kw in kit.keywords)
        score += sum(_has(lowered, item.keywords) for item in kit.items)
        score += sum(p.category == kit.key for p in rx_products)
        scores[kit.key] = score
    best = max(scores.values(), default=0)
    top = [key for key, s in scores.items() if s == best]
    kit_key = top[0] if best > 0 and len(top) == 1 else None

    if _has(lowered, ASAP_WORDS):
        urgency = "asap"
    elif _has(lowered, TODAY_WORDS):
        urgency = "today"
    else:
        urgency = None

    return Signals(
        kit_key=kit_key,
        item_keys=[i.key for i in kits[kit_key].items if _has(lowered, i.keywords)] if kit_key else [],
        whole_kit=_has(lowered, WHOLE_KIT_WORDS),
        budget_cents=_stated_budget(text),
        urgency=urgency,
        rx_requested=[p.name for p in rx_products] + [t for t in RX_TERMS if t in lowered],
        emergency=bool(EMERGENCY.search(text)),
    )


def build_intent(
    text: str, signals: Signals, kits: dict[str, Kit], catalog: dict[str, Product]
) -> OrderIntent | Clarify | Emergency | Refuse:
    lowered = text.lower()
    if signals.emergency or EMERGENCY.search(text):
        return Emergency()

    rx_products = _rx_products_in(lowered, catalog) + _rx_products_named(signals.rx_requested, catalog)
    rx_requested = list(dict.fromkeys([p.name for p in rx_products] + signals.rx_requested + [t for t in RX_TERMS if t in lowered]))

    if signals.kit_key not in kits:
        if rx_requested:
            return Refuse(_rx_message(rx_requested) + " " + _kit_menu(kits))
        return Clarify(_kit_menu(kits))

    kit = kits[signals.kit_key]
    notes: list[str] = []

    # A prescription product stands in for one kit item (e.g. G7 for the CGM slot). Never swap in the OTC item silently.
    excluded = set()
    for p in dict.fromkeys(rx_products):
        for item in kit.items:
            if p.slot == item.key and item.key not in excluded and not _names_approved_product(lowered, item, catalog):
                excluded.add(item.key)
                notes.append(f"I left out {item.label.lower()}: you asked for {p.name}, and I won't substitute a different product.")

    candidates = [i for i in kit.items if i.key not in excluded]
    named = [i for i in candidates if i.key in signals.item_keys]
    # Only asked for a prescription item: refuse rather than order the rest of the kit unasked.
    if rx_requested and not named and not signals.whole_kit:
        return Refuse(_rx_message(rx_requested))
    items = named if named and not signals.whole_kit else candidates
    if not items:
        return Refuse(_rx_message(rx_requested))

    cap = kit.budget_cap_cents
    stated = signals.budget_cents
    if stated is not None:
        if stated <= cap:
            cap = stated
        else:
            notes.append(f"Your profile caps {kit.label.lower()} at {fmt(cap)}, so I kept to that instead of {fmt(stated)}.")

    return OrderIntent(
        kit=kit,
        items=items,
        budget_cap_cents=cap,
        urgency=signals.urgency or "standard",
        urgency_stated=signals.urgency is not None,
        rx_refused=rx_requested,
        notes=notes,
        location=signals.location,
    )


def _rx_products_in(lowered: str, catalog: dict[str, Product]) -> list[Product]:
    return [p for p in catalog.values() if p.rx and _has(lowered, p.keywords)]


def _rx_products_named(names: list[str], catalog: dict[str, Product]) -> list[Product]:
    """Catalog prescription products matching names the model reported (e.g. "Dexcom G7")."""
    lowered = " ".join(names).lower()
    return [p for p in catalog.values() if p.rx and (_has(lowered, p.keywords) or p.brand.lower() in lowered)]


def _names_approved_product(lowered: str, item: KitItem, catalog: dict[str, Product]) -> bool:
    approved = [p for p in catalog.values() if not p.rx and matches(p, item.match)]
    return any(_has(lowered, p.keywords) for p in approved)


def _stated_budget(text: str) -> int | None:
    for pattern in BUDGET_PATTERNS:
        found = pattern.search(text)
        if found:
            return to_cents(float(found.group(1).replace(",", "") + (found.group(2) or "")))
    return None


def _rx_message(rx_requested: list[str]) -> str:
    if not rx_requested:
        return "I couldn't find anything I'm allowed to order for that."
    names = ", ".join(dict.fromkeys(rx_requested))
    return (
        f"I can't order {names}: prescription-only items need a pharmacist and a valid prescription. "
        "Ask your pharmacy or prescriber for a refill."
    )
