"""What the user sees in ASI:One: plain-text summaries plus an ASI Interactive Card for one-tap approval."""

import json
from datetime import datetime, timezone
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, EndSessionContent, MetadataContent, TextContent

from .catalog import fmt
from .intent import URGENCY_LABEL
from .planner import Cart


def eta(minutes: int) -> str:
    if minutes < 90:
        return f"about {minutes} min"
    if minutes < 1440:
        return f"about {round(minutes / 60)} hours"
    return f"about {round(minutes / 1440)} days"


def text_message(text: str, end_session: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)


def review_message(cart: Cart, rx_refused: list[str]) -> ChatMessage:
    lines = [f"**{cart.kit_label}**: the cheapest order that fits your rules, delivered {URGENCY_LABEL[cart.urgency]}.", ""]
    for line in cart.lines:
        merchant = cart.merchants[line.merchant_id].name
        lines.append(f"- {line.item_label}: {line.product_name} ({line.qty}x), {fmt(line.total_cents)} from {merchant}")
    for m in cart.merchants.values():
        fee = fmt(m.delivery_fee_cents) if m.delivery_fee_cents else "free"
        lines.append(f"- Delivery from {m.name}: {fee}, arrives in {eta(m.delivery_minutes)}")
    lines += ["", f"**Total: {fmt(cart.total_cents)}** (your limit is {fmt(cart.budget_cap_cents)})"]
    if cart.dropped:
        lines.append(f"Left out to stay under budget: {', '.join(cart.dropped)}.")
    if cart.unavailable:
        lines.append(f"Not available in time: {', '.join(cart.unavailable)}.")
    if rx_refused:
        lines.append(f"Not ordered (prescription only): {', '.join(dict.fromkeys(rx_refused))}.")
    lines += cart.notes
    lines += [
        "",
        "Only products you pre-approved, no substitutions. Nothing is charged until you approve.",
        "Reply **approve** to pay, or **cancel**.",
    ]

    rows = [
        {"label": line.item_label, "value": f"{line.product_name}, {fmt(line.total_cents)} ({cart.merchants[line.merchant_id].name})"}
        for line in cart.lines
    ]
    rows += [
        {"label": f"Delivery, {m.name}", "value": f"{fmt(m.delivery_fee_cents)}, {eta(m.delivery_minutes)}"} for m in cart.merchants.values()
    ]
    rows.append({"label": "Total", "value": f"{fmt(cart.total_cents)} of {fmt(cart.budget_cap_cents)} budget"})
    card = {
        "title": f"Approve {cart.kit_label.lower()} order",
        "summary_rows": rows,
        "approve_cta": {"label": f"Approve {fmt(cart.total_cents)}", "primary": True, "selection": {"action": "approve", "cart_id": cart.id}},
        "reject_cta": {"label": "Cancel", "selection": {"action": "cancel", "cart_id": cart.id}},
    }
    return ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[
            TextContent(type="text", text="\n".join(lines)),
            MetadataContent(
                type="metadata",
                metadata={
                    "card_protocol_version": "1",
                    "requires_card_interaction": "true",
                    "card_kind": "review",
                    "card_payload": json.dumps(card),
                },
            ),
        ],
    )


def receipt_message(cart: Cart, paid: list[dict], failed: list[dict], card_label: str) -> ChatMessage:
    if not paid:
        header = "**Order not placed**"
    elif failed:
        header = "**Order partly placed**"
    else:
        header = "**Order placed**"
    lines = [header, ""]
    for p in paid:
        lines.append(f"- {p['merchant']}: {fmt(p['amount_cents'])} paid, order `{p['order_id']}`, auth `{p['auth_id']}`, arrives in {eta(p['eta_minutes'])}")
        for item in p["items"]:
            lines.append(f"  - {item}")
    for f in failed:
        lines.append(f"- {f['merchant']}: **not placed**, {f['reason']}. You weren't charged for it.")
    if paid:
        total = sum(p["amount_cents"] for p in paid)
        lines += ["", f"Charged {fmt(total)} to {card_label}. Nothing real was charged: this demo uses simulated merchants and payments."]
    else:
        lines += ["", "Nothing was charged. Ask again and I'll get fresh prices."]
    return text_message("\n".join(lines), end_session=True)
