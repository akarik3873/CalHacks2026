// Synthetic demo persona "Maya". All data is made up.
//
// The planted signal (dates are days before today):
//   day 98  starts omeprazole for heartburn; heartburn drops off after
//   day 63+ fatigue starts rising, and keeps climbing in frequency and severity
//   day 56+ resting heart rate creeps up; last 4 weeks she gets winded on stairs
//   day 34  annual labs: ferritin, hemoglobin and MCV come back low. Nobody follows up.
// Noise that should NOT explain it: steady sleep, normal TSH and B12, steady headaches.

import type { IndexName } from "../scripts/lib.js";

export type SeedDoc = { index: IndexName; id: string; doc: Record<string, unknown> };

export const USER_ID = "maya";
const DAY_MS = 86_400_000;
const DAYS = 180;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Lab = { name: string; value: number; unit: string; low: number; high: number };

const LABS_EARLY: Lab[] = [
  { name: "ferritin", value: 48, unit: "ng/mL", low: 15, high: 150 },
  { name: "hemoglobin", value: 13.1, unit: "g/dL", low: 12.0, high: 15.5 },
  { name: "mcv", value: 88, unit: "fL", low: 80, high: 100 },
  { name: "tsh", value: 1.9, unit: "mIU/L", low: 0.4, high: 4.0 },
  { name: "vitamin_b12", value: 510, unit: "pg/mL", low: 200, high: 900 },
  { name: "vitamin_d", value: 22, unit: "ng/mL", low: 30, high: 100 },
];

const LABS_RECENT: Lab[] = [
  { name: "ferritin", value: 11, unit: "ng/mL", low: 15, high: 150 },
  { name: "hemoglobin", value: 11.3, unit: "g/dL", low: 12.0, high: 15.5 },
  { name: "mcv", value: 78, unit: "fL", low: 80, high: 100 },
  { name: "tsh", value: 2.1, unit: "mIU/L", low: 0.4, high: 4.0 },
  { name: "vitamin_b12", value: 380, unit: "pg/mL", low: 200, high: 900 },
  { name: "vitamin_d", value: 36, unit: "ng/mL", low: 30, high: 100 },
];

const PHRASES: Record<string, string[]> = {
  fatigue: [
    "so tired today",
    "wiped out by 3pm again",
    "needed a nap after lunch",
    "exhausted even after 8 hours of sleep",
    "dragging all day, coffee isn't helping",
    "felt like a zombie at work",
    "no energy for the gym today",
    "tired tired tired",
    "could barely get through the afternoon",
    "went to bed at 10, still woke up exhausted",
  ],
  heartburn: ["heartburn after dinner again", "acid reflux after my coffee", "reflux kept me up last night", "bad heartburn after pizza"],
  headache: ["headache after too much screen time", "mild headache this afternoon", "tension headache, took an ibuprofen"],
  shortness_of_breath: ["got winded on the stairs at work", "out of breath walking up the hill, never used to be", "stairs left me huffing today"],
  dizziness: ["a bit lightheaded when I stood up", "head rush getting out of bed", "felt dizzy for a sec in the shower"],
};

/** Chance per day that Maya logs each symptom, and how bad it is, by days before today. */
function symptomOdds(name: string, day: number): { p: number; severity: [number, number] } {
  switch (name) {
    case "heartburn":
      return day > 98 ? { p: 0.35, severity: [4, 7] } : { p: 0.04, severity: [2, 4] };
    case "fatigue": {
      if (day > 63) return { p: 0.05, severity: [3, 4] };
      const ramp = (63 - day) / 63;
      return { p: 0.1 + ramp * 0.55, severity: [4 + Math.round(ramp * 2), 5 + Math.round(ramp * 3)] };
    }
    case "headache":
      return { p: 0.08, severity: [3, 6] };
    case "shortness_of_breath":
      return day <= 28 ? { p: 0.22, severity: [3, 5] } : { p: 0, severity: [0, 0] };
    case "dizziness":
      return day <= 40 ? { p: 0.08, severity: [2, 4] } : { p: 0, severity: [0, 0] };
    default:
      return { p: 0, severity: [0, 0] };
  }
}

const MESSAGES: [day: number, text: string][] = [
  [170, "starting vitamin D, doctor said my levels were low"],
  [140, "trying to cut back on coffee"],
  [120, "the acid thing is getting old, booked a doctor appt"],
  [98, "doc put me on omeprazole for the heartburn"],
  [85, "omeprazole is honestly working, heartburn way better"],
  [75, "ran 3 miles this morning, felt great"],
  [60, "new project at work is busy but fine"],
  [50, "skipped my run, just didn't have it in me"],
  [30, "is it normal to be this tired all the time?"],
  [12, "my friend said I look pale lol"],
];

export function generateMaya(now = new Date()): SeedDoc[] {
  const rand = mulberry32(2026);
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const gaussian = () => (rand() + rand() + rand() - 1.5) * 2; // roughly N(0, 1)

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (day: number, hour: number) => new Date(today - day * DAY_MS + hour * 3_600_000).toISOString();
  const isoDate = (day: number) => at(day, 0).slice(0, 10);

  const docs: SeedDoc[] = [];
  const timeline = (id: string, doc: Record<string, unknown>) =>
    docs.push({ index: "health-timeline", id: `${USER_ID}-${id}`, doc: { user_id: USER_ID, ...doc } });

  for (let day = DAYS; day >= 1; day--) {
    // Sleep is steady the whole time, so it should be ruled out.
    timeline(`sleep-${day}`, { "@timestamp": at(day, 7), kind: "sleep", name: "sleep_hours", value: +(7.1 + gaussian() * 0.5).toFixed(1), unit: "h", source: "apple_health" });

    const hrDrift = day <= 56 ? ((56 - day) / 56) * 8 : 0;
    timeline(`hr-${day}`, { "@timestamp": at(day, 8), kind: "vital", name: "resting_hr", value: Math.round(62 + hrDrift + gaussian() * 2), unit: "bpm", source: "apple_health" });

    for (const name of Object.keys(PHRASES)) {
      const { p, severity } = symptomOdds(name, day);
      if (rand() >= p) continue;
      timeline(`${name}-${day}`, {
        "@timestamp": at(day, between(10, 22)),
        kind: "symptom",
        name,
        severity: between(...severity),
        text: pick(PHRASES[name]),
        source: "messenger",
      });
    }
  }

  for (const [day, text] of MESSAGES) {
    timeline(`message-${day}`, { "@timestamp": at(day, 19), kind: "message", name: "message", text, source: "messenger" });
  }

  timeline("med-vitamin_d", { "@timestamp": at(170, 9), kind: "med", name: "vitamin_d", action: "start", value: 1000, unit: "IU", text: "Started vitamin D 1000 IU daily.", source: "app" });
  timeline("med-omeprazole", { "@timestamp": at(98, 9), kind: "med", name: "omeprazole", action: "start", value: 20, unit: "mg", text: "Started omeprazole 20 mg daily for heartburn.", source: "app" });

  const labReport = (docId: string, day: number, labs: Lab[]) => {
    const rows = labs.map((lab) => {
      const flag = lab.value < lab.low ? "low" : lab.value > lab.high ? "high" : "normal";
      timeline(`lab-${docId}-${lab.name}`, {
        "@timestamp": at(day, 8),
        kind: "lab",
        name: lab.name,
        value: lab.value,
        unit: lab.unit,
        ref_low: lab.low,
        ref_high: lab.high,
        flag,
        doc_id: docId,
        source: "lab_pdf",
      });
      return `${lab.name.toUpperCase().padEnd(12)} ${String(lab.value).padEnd(6)} ${lab.unit.padEnd(6)} (${lab.low}-${lab.high})${flag === "normal" ? "" : `  ${flag.toUpperCase()}`}`;
    });
    docs.push({
      index: "health-docs",
      id: docId,
      doc: {
        user_id: USER_ID,
        doc_id: docId,
        doc_type: "lab_report",
        doc_date: at(day, 8),
        title: `Lab results ${isoDate(day)}`,
        content: [
          "Bayview Clinical Lab (synthetic demo data)",
          `Patient: Maya R.   Collected: ${isoDate(day)}`,
          "TEST         RESULT UNITS  (REFERENCE RANGE)",
          ...rows,
          "Results released to patient portal. No provider comment.",
        ].join("\n"),
      },
    });
  };

  labReport(`${USER_ID}-labs-1`, 172, LABS_EARLY);
  labReport(`${USER_ID}-labs-2`, 34, LABS_RECENT);

  const visitNote = (docId: string, day: number, content: string) =>
    docs.push({
      index: "health-docs",
      id: docId,
      doc: { user_id: USER_ID, doc_id: docId, doc_type: "visit_note", doc_date: at(day, 15), title: `Visit note ${isoDate(day)}`, content },
    });

  visitNote(
    `${USER_ID}-visit-1`,
    98,
    "Visit note (synthetic demo data). Reason: heartburn about 2 months, worse after coffee and late meals. No trouble swallowing, no weight loss. Plan: start omeprazole 20 mg daily before breakfast. Cut back on coffee. Follow up as needed.",
  );
  visitNote(
    `${USER_ID}-visit-2`,
    34,
    "Annual physical (synthetic demo data). Patient reports feeling more tired lately, thinks it is work stress. Heartburn controlled on omeprazole 20 mg daily, continue. Exam unremarkable. Labs drawn: CBC, ferritin, TSH, B12, vitamin D. Return in 12 months.",
  );

  return docs;
}
