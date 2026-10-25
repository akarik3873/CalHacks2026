"""Card payments. SimulatedCardNetwork stands in for the Visa sandbox until we have sandbox credentials: nothing real is charged."""

from dataclasses import dataclass
from uuid import uuid4


@dataclass
class Authorization:
    amount_cents: int
    merchant_id: str
    reference: str
    status: str  # authorized | captured | voided


class SimulatedCardNetwork:
    card_label = "Visa test card ending 1111 (simulated)"

    def __init__(self) -> None:
        self._auths: dict[str, Authorization] = {}

    def authorize(self, amount_cents: int, merchant_id: str, reference: str) -> str:
        auth_id = f"SIMAUTH-{uuid4().hex[:10].upper()}"
        self._auths[auth_id] = Authorization(amount_cents, merchant_id, reference, "authorized")
        return auth_id

    def verify(self, auth_id: str, amount_cents: int, merchant_id: str, reference: str) -> bool:
        auth = self._auths.get(auth_id)
        return (
            auth is not None
            and auth.status == "authorized"
            and auth.amount_cents == amount_cents
            and auth.merchant_id == merchant_id
            and auth.reference == reference
        )

    def capture(self, auth_id: str) -> None:
        self._auths[auth_id].status = "captured"

    def void(self, auth_id: str) -> None:
        auth = self._auths.get(auth_id)
        if auth and auth.status == "authorized":
            auth.status = "voided"

    def status(self, auth_id: str) -> str | None:
        auth = self._auths.get(auth_id)
        return auth.status if auth else None
