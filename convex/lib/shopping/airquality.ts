// Live air quality from Open-Meteo (free, no key) for allergy and air-quality orders.
import { OrderIntent } from "./intent";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT_MS = 8000;
const UNHEALTHY_FOR_SENSITIVE = 101;
export const CITES_BAD_AIR = /\baqi\b|air quality|smoke|smoky|wildfire|haze/i;

export type AirReading = { place: string; usAqi: number; pm25: number | null };

function category(aqi: number) {
  const bands: [number, string][] = [
    [50, "good"],
    [100, "moderate"],
    [150, "unhealthy for sensitive groups"],
    [200, "unhealthy"],
    [300, "very unhealthy"],
  ];
  return bands.find(([limit]) => aqi <= limit)?.[1] ?? "hazardous";
}

// Current US AQI for a place name. Returns null if the place isn't found or the service is down.
export async function fetchAirQuality(location: string): Promise<AirReading | null> {
  const name = location.split(",")[0].trim();
  if (!name) return null;
  try {
    const geo = await fetch(`${GEOCODE_URL}?${new URLSearchParams({ name, count: "1" })}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const place = ((await geo.json()).results ?? [])[0];
    if (!place) return null;
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "us_aqi,pm2_5",
      timezone: "auto",
    });
    const air = await fetch(`${AIR_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const current = (await air.json()).current;
    if (current?.us_aqi == null) return null;
    return {
      place: [place.name, place.admin1].filter(Boolean).join(", "),
      usAqi: Math.round(current.us_aqi),
      pm25: current.pm2_5 ?? null,
    };
  } catch (e) {
    console.warn(`air quality lookup failed for ${location}`, e);
    return null;
  }
}

// Bad air: keep the items the profile marks essential at that AQI, and deliver today unless the user said otherwise.
// Good air: change nothing, just report it. Never adds items the user didn't ask for.
export function adjustForAirQuality(intent: OrderIntent, reading: AirReading | null, citedBadAir: boolean): OrderIntent {
  if (!reading) return { ...intent, notes: [...intent.notes, "I couldn't get live air quality right now, so I planned without it."] };

  let summary = `Live air quality in ${reading.place}: US AQI ${reading.usAqi} (${category(reading.usAqi)})`;
  if (reading.pm25 !== null) summary += `, PM2.5 ${reading.pm25} µg/m³`;
  summary += " (Open-Meteo).";

  if (reading.usAqi < UNHEALTHY_FOR_SENSITIVE) {
    const note = summary + (citedBadAir ? " The air looks OK right now, so optional items stay optional." : "");
    return { ...intent, notes: [...intent.notes, note] };
  }

  const items = intent.items.map((i) =>
    i.aqiEssential !== undefined && reading.usAqi >= i.aqiEssential ? { ...i, essential: true } : i,
  );
  const kept = items.filter((i, n) => i.essential && !intent.items[n].essential).map((i) => i.label);
  const changes: string[] = [];
  if (kept.length) changes.push(`I'm treating ${kept.join(", ").toLowerCase()} as essential`);
  let urgency = intent.urgency;
  if (!intent.urgencyStated && urgency === "standard") {
    urgency = "today";
    changes.push("set delivery to today");
  }
  const note = summary + (changes.length ? ` Because of that, ${changes.join(" and ")}.` : "");
  return { ...intent, items, urgency, notes: [...intent.notes, note] };
}
