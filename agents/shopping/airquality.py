"""Live air quality from Open-Meteo (free, no key) for allergy and air-quality orders."""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace

import aiohttp

from .intent import OrderIntent

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
TIMEOUT_SECONDS = 8
UNHEALTHY_FOR_SENSITIVE = 101
CITES_BAD_AIR = re.compile(r"\baqi\b|air quality|smoke|smoky|wildfire|haze", re.IGNORECASE)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AirReading:
    place: str
    us_aqi: int
    pm2_5: float | None
    observed_at: str  # local time, as Open-Meteo reports it

    @property
    def category(self) -> str:
        for limit, name in ((50, "good"), (100, "moderate"), (150, "unhealthy for sensitive groups"), (200, "unhealthy"), (300, "very unhealthy")):
            if self.us_aqi <= limit:
                return name
        return "hazardous"


AirLookup = Callable[[str], Awaitable[AirReading | None]]


async def fetch_air_quality(location: str) -> AirReading | None:
    """Current US AQI for a place name. Returns None if the place isn't found or the service is down."""
    name = location.split(",")[0].strip()
    if not name:
        return None
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)) as session:
            async with session.get(GEOCODE_URL, params={"name": name, "count": 1}) as res:
                places = (await res.json()).get("results") or []
            if not places:
                return None
            place = places[0]
            params = {"latitude": place["latitude"], "longitude": place["longitude"], "current": "us_aqi,pm2_5", "timezone": "auto"}
            async with session.get(AIR_URL, params=params) as res:
                current = (await res.json())["current"]
        if current.get("us_aqi") is None:
            return None
        label = ", ".join(p for p in (place.get("name"), place.get("admin1")) if p)
        return AirReading(place=label, us_aqi=round(current["us_aqi"]), pm2_5=current.get("pm2_5"), observed_at=current.get("time", ""))
    except Exception as error:  # network, timeout, or an unexpected response shape
        logger.warning(f"Air quality lookup failed for {location!r}: {error!r}")
        return None


def adjust_for_air_quality(intent: OrderIntent, reading: AirReading | None, cited_bad_air: bool) -> OrderIntent:
    """Bad air: keep the items the profile marks essential at that AQI, and deliver today unless the user said otherwise.
    Good air: change nothing, just report it. Never adds items the user didn't ask for."""
    if reading is None:
        return replace(intent, notes=[*intent.notes, "I couldn't get live air quality right now, so I planned without it."])

    summary = f"Live air quality in {reading.place}: US AQI {reading.us_aqi} ({reading.category})"
    if reading.pm2_5 is not None:
        summary += f", PM2.5 {reading.pm2_5:g} µg/m³"
    summary += " (Open-Meteo)."

    if reading.us_aqi < UNHEALTHY_FOR_SENSITIVE:
        note = summary + (" The air looks OK right now, so optional items stay optional." if cited_bad_air else "")
        return replace(intent, notes=[*intent.notes, note])

    items = [
        replace(i, essential=True) if i.aqi_essential is not None and reading.us_aqi >= i.aqi_essential else i for i in intent.items
    ]
    kept = [i.label for i, before in zip(items, intent.items) if i.essential and not before.essential]
    changes = []
    if kept:
        changes.append(f"I'm treating {', '.join(kept).lower()} as essential")
    urgency = intent.urgency
    if not intent.urgency_stated and urgency == "standard":
        urgency = "today"
        changes.append("set delivery to today")
    note = summary + (f" Because of that, {' and '.join(changes)}." if changes else "")
    return replace(intent, items=items, urgency=urgency, notes=[*intent.notes, note])
