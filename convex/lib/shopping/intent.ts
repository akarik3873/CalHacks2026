// Turns a request into a structured order intent. Deterministic on purpose: the shopper never guesses at products.
import { CATALOG, fmt, has, Kit, KIT_LIST, KITS_BY_KEY, KitItem, matches, Product, toCents } from "./catalog";

export type Urgency = "asap" | "today" | "standard";
export const URGENCY_MAX_MINUTES: Record<Urgency, number> = { asap: 120, today: 720, standard: 4320 };
export const URGENCY_LABEL: Record<Urgency, string> = { asap: "within 2 hours", today: "today", standard: "within 3 days" };

const EMERGENCY =
  /chest pain|can'?t breathe|cannot breathe|trouble breathing|not breathing|passed out|fainted|unconscious|unresponsive|seizure|anaphyla|throat (?:is )?(?:closing|swelling)|severe (?:allergic )?reaction|suicid|overdos/i;
export const EMERGENCY_REPLY =
  "This sounds like it could be an emergency, and a delivery won't arrive fast enough. " +
  "Please call 911 (or your local emergency number) now. For low blood sugar, use the fast-acting glucose you have on hand " +
  "and follow your care plan. I haven't ordered anything.";

// Prescription-only items people may ask for that aren't in the catalog. Catalog Rx items are detected by their own keywords.
const RX_TERMS = ["insulin", "antibiotic", "amoxicillin", "ozempic", "wegovy", "metformin", "epipen", "epinephrine", "adderall", "xanax"];

const ASAP_WORDS = ["asap", "urgent", "right away", "right now", "immediately", "within an hour", "in an hour", "as soon as possible"];
const TODAY_WORDS = ["today", "tonight", "this evening", "this afternoon", "same day", "same-day"];
const WHOLE_KIT_WORDS = ["kit", "everything", "restock", "usual", "supplies", "all my"];
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?`; // 1,000 or 1000, optional cents
const BUDGET_PATTERNS = [new RegExp(String.raw`\$\s*` + AMOUNT), new RegExp(String.raw`\b` + AMOUNT + String.raw`\s*(?:dollars|usd|bucks)\b`, "i")];

export type OrderIntent = {
  type: "order";
  kit: Kit;
  items: KitItem[];
  budgetCapCents: number;
  urgency: Urgency;
  urgencyStated: boolean;
  rxRefused: string[];
  notes: string[];
  location?: string;
};
export type Clarify = { type: "clarify"; message: string };
export type Emergency = { type: "emergency"; message: string };
export type Refuse = { type: "refuse"; message: string };
export type Intent = OrderIntent | Clarify | Emergency | Refuse;

// What a request asks for, read by the keyword rules or by the model. Not trusted on its own:
// buildIntent re-applies every safety rule to the raw text.
export type Signals = {
  kitKey: string | null;
  itemKeys: string[]; // items the user named
  wholeKit: boolean;
  budgetCents: number | null;
  urgency: "asap" | "today" | null; // null = not stated
  rxRequested: string[];
  emergency: boolean;
  location?: string;
  source: "rules" | "model";
};

const unique = <T>(xs: T[]) => [...new Set(xs)];

export function kitMenu() {
  const names = KIT_LIST.map((k) => k.label).join(", ");
  return (
    `I can restock these kits: ${names}. Tell me what you need, how soon, and a budget, ` +
    'e.g. "Pollen is spiking, restock my allergy kit today, under $50."'
  );
}

export function ruleSignals(text: string): Signals {
  const lowered = text.toLowerCase();
  const rxProducts = rxProductsIn(lowered);

  const scores = KIT_LIST.map((kit) => ({
    key: kit.key,
    score:
      kit.keywords.filter((kw) => lowered.includes(kw)).length +
      kit.items.filter((item) => has(lowered, item.keywords)).length +
      rxProducts.filter((p) => p.category === kit.key).length,
  }));
  const best = Math.max(0, ...scores.map((s) => s.score));
  const top = scores.filter((s) => s.score === best);
  const kitKey = best > 0 && top.length === 1 ? top[0].key : null;

  return {
    kitKey,
    itemKeys: kitKey ? KITS_BY_KEY[kitKey].items.filter((i) => has(lowered, i.keywords)).map((i) => i.key) : [],
    wholeKit: has(lowered, WHOLE_KIT_WORDS),
    budgetCents: statedBudget(text),
    urgency: has(lowered, ASAP_WORDS) ? "asap" : has(lowered, TODAY_WORDS) ? "today" : null,
    rxRequested: [...rxProducts.map((p) => p.name), ...RX_TERMS.filter((t) => lowered.includes(t))],
    emergency: EMERGENCY.test(text),
    source: "rules",
  };
}

export function buildIntent(text: string, signals: Signals): Intent {
  const lowered = text.toLowerCase();
  if (signals.emergency || EMERGENCY.test(text)) return { type: "emergency", message: EMERGENCY_REPLY };

  const rxProducts = unique([...rxProductsIn(lowered), ...rxProductsNamed(signals.rxRequested)]);
  const rxRequested = unique([...rxProducts.map((p) => p.name), ...signals.rxRequested, ...RX_TERMS.filter((t) => lowered.includes(t))]);

  const kit = signals.kitKey ? KITS_BY_KEY[signals.kitKey] : undefined;
  if (!kit) {
    if (rxRequested.length) return { type: "refuse", message: `${rxMessage(rxRequested)} ${kitMenu()}` };
    return { type: "clarify", message: kitMenu() };
  }
  const notes: string[] = [];

  // A prescription product stands in for one kit item (e.g. G7 for the CGM slot). Never swap in the OTC item silently.
  const excluded = new Set<string>();
  for (const p of rxProducts) {
    for (const item of kit.items) {
      if (p.slot === item.key && !excluded.has(item.key) && !namesApprovedProduct(lowered, item)) {
        excluded.add(item.key);
        notes.push(`I left out ${item.label.toLowerCase()}: you asked for ${p.name}, and I won't substitute a different product.`);
      }
    }
  }

  const candidates = kit.items.filter((i) => !excluded.has(i.key));
  const named = candidates.filter((i) => signals.itemKeys.includes(i.key));
  // Only asked for a prescription item: refuse rather than order the rest of the kit unasked.
  if (rxRequested.length && !named.length && !signals.wholeKit) return { type: "refuse", message: rxMessage(rxRequested) };
  const items = named.length && !signals.wholeKit ? named : candidates;
  if (!items.length) return { type: "refuse", message: rxMessage(rxRequested) };

  let cap = kit.budgetCapCents;
  const stated = signals.budgetCents;
  if (stated !== null) {
    if (stated <= cap) cap = stated;
    else notes.push(`Your profile caps ${kit.label.toLowerCase()} at ${fmt(cap)}, so I kept to that instead of ${fmt(stated)}.`);
  }

  return {
    type: "order",
    kit,
    items,
    budgetCapCents: cap,
    urgency: signals.urgency ?? "standard",
    urgencyStated: signals.urgency !== null,
    rxRefused: rxRequested,
    notes,
    location: signals.location,
  };
}

const rxProductsIn = (lowered: string): Product[] =>
  Object.values(CATALOG).filter((p) => p.rx && has(lowered, p.keywords));

// Catalog prescription products matching names the model reported (e.g. "Dexcom G7").
function rxProductsNamed(names: string[]): Product[] {
  const lowered = names.join(" ").toLowerCase();
  return Object.values(CATALOG).filter((p) => p.rx && (has(lowered, p.keywords) || lowered.includes(p.brand.toLowerCase())));
}

function namesApprovedProduct(lowered: string, item: KitItem) {
  return Object.values(CATALOG).some((p) => !p.rx && matches(p, item.match) && has(lowered, p.keywords));
}

export function statedBudget(text: string): number | null {
  for (const pattern of BUDGET_PATTERNS) {
    const found = text.match(pattern);
    if (found) return toCents(parseFloat(found[1].replace(/,/g, "") + (found[2] ?? "")));
  }
  return null;
}

function rxMessage(rxRequested: string[]) {
  if (!rxRequested.length) return "I couldn't find anything I'm allowed to order for that.";
  return (
    `I can't order ${unique(rxRequested).join(", ")}: prescription-only items need a pharmacist and a valid prescription. ` +
    "Ask your pharmacy or prescriber for a refill."
  );
}
