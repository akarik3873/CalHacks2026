"""Loads the product catalog, the user's approved-item profile, and the merchant list from agents/data/."""

import json
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def to_cents(dollars: float) -> int:
    return round(dollars * 100)


def fmt(cents: int) -> str:
    return f"${cents / 100:,.2f}"


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    brand: str
    category: str
    list_price_cents: int
    rx: bool
    active_ingredient: str | None = None
    strength: str | None = None
    # For prescription products: the kit item this product would stand in for (e.g. a CGM sensor).
    slot: str | None = None
    keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class KitItem:
    key: str
    label: str
    match: dict[str, str]
    qty: int
    essential: bool
    keywords: tuple[str, ...]
    # Becomes essential when live US AQI is at or above this (e.g. a HEPA filter on a smoky day).
    aqi_essential: int | None = None


@dataclass(frozen=True)
class Kit:
    key: str
    label: str
    budget_cap_cents: int
    keywords: tuple[str, ...]
    items: tuple[KitItem, ...]


@dataclass(frozen=True)
class MerchantInfo:
    id: str
    name: str
    price_factor: float
    delivery_fee_cents: int
    delivery_minutes: int
    stock: int
    out_of_stock: frozenset[str]
    not_carried: frozenset[str]


def _read(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def load_catalog() -> dict[str, Product]:
    products = {}
    for p in _read("catalog.json")["products"]:
        products[p["sku"]] = Product(
            sku=p["sku"],
            name=p["name"],
            brand=p["brand"],
            category=p["category"],
            list_price_cents=to_cents(p["list_price"]),
            rx=p["rx"],
            active_ingredient=p.get("active_ingredient"),
            strength=p.get("strength"),
            slot=p.get("slot"),
            keywords=tuple(p.get("keywords", [])),
        )
    return products


def load_kits() -> dict[str, Kit]:
    kits = {}
    for key, k in _read("profile.json")["kits"].items():
        items = tuple(
            KitItem(
                key=i["key"],
                label=i["label"],
                match=i["match"],
                qty=i["qty"],
                essential=i["essential"],
                keywords=tuple(i["keywords"]),
                aqi_essential=i.get("aqi_essential"),
            )
            for i in k["items"]
        )
        kits[key] = Kit(key=key, label=k["label"], budget_cap_cents=to_cents(k["budget_cap"]), keywords=tuple(k["keywords"]), items=items)
    return kits


def load_default_location() -> str:
    return _read("profile.json")["location"]


def load_merchants() -> list[MerchantInfo]:
    return [
        MerchantInfo(
            id=m["id"],
            name=m["name"],
            price_factor=m["price_factor"],
            delivery_fee_cents=to_cents(m["delivery_fee"]),
            delivery_minutes=m["delivery_minutes"],
            stock=m["stock"],
            out_of_stock=frozenset(m["out_of_stock"]),
            not_carried=frozenset(m["not_carried"]),
        )
        for m in _read("merchants.json")["merchants"]
    ]


def matches(product: Product, rule: dict[str, str]) -> bool:
    """True only if the product equals the approved rule on every field the rule names (no substitutions)."""
    for field, wanted in rule.items():
        actual = getattr(product, field, None)
        if actual is None or str(actual).strip().lower() != str(wanted).strip().lower():
            return False
    return True
