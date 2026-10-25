// Picks the cheapest cart that meets the user's rules: approved products only, in stock, delivered in time, under budget.
import { approvedSkus, CATALOG, fmt, KitItem } from "./catalog";
import { OrderIntent, URGENCY_MAX_MINUTES, Urgency } from "./intent";

export type MerchantQuote = {
  merchantId: string;
  name: string;
  deliveryFeeCents: number;
  deliveryMinutes: number;
  offers: Record<string, { priceCents: number; stock: number }>; // by sku
};

export type CartLine = {
  itemKey: string;
  itemLabel: string;
  sku: string;
  productName: string;
  qty: number;
  unitPriceCents: number;
  merchantId: string;
};

export type CartMerchant = { merchantId: string; name: string; deliveryFeeCents: number; deliveryMinutes: number };

export type Cart = {
  kitKey: string;
  kitLabel: string;
  urgency: Urgency;
  budgetCapCents: number;
  lines: CartLine[];
  merchants: CartMerchant[];
  dropped: string[];
  unavailable: string[];
  notes: string[];
  // What the same items would cost from each merchant alone, for every merchant that has them all in time.
  singleStoreTotals: { name: string; totalCents: number }[];
};

export type NoCart = { message: string };

type Option = { quote: MerchantQuote; sku: string; priceCents: number };

export const lineTotal = (l: CartLine) => l.unitPriceCents * l.qty;
export const linesFor = (cart: Pick<Cart, "lines">, merchantId: string) => cart.lines.filter((l) => l.merchantId === merchantId);
export function merchantTotalCents(cart: Pick<Cart, "lines" | "merchants">, merchantId: string) {
  const fee = cart.merchants.find((m) => m.merchantId === merchantId)?.deliveryFeeCents ?? 0;
  return linesFor(cart, merchantId).reduce((s, l) => s + lineTotal(l), 0) + fee;
}
export const cartTotalCents = (cart: Pick<Cart, "lines" | "merchants">) =>
  cart.merchants.reduce((s, m) => s + merchantTotalCents(cart, m.merchantId), 0);

export function planCart(intent: OrderIntent, quotes: MerchantQuote[]): Cart | NoCart {
  const fastEnough = quotes.filter((q) => q.deliveryMinutes <= URGENCY_MAX_MINUTES[intent.urgency]);

  const candidates: Record<string, Option[]> = {};
  const unavailable: string[] = [];
  for (const item of intent.items) {
    const options = fastEnough.flatMap((quote) =>
      approvedSkus(item)
        .filter((sku) => quote.offers[sku] && quote.offers[sku].stock >= item.qty)
        .map((sku) => ({ quote, sku, priceCents: quote.offers[sku].priceCents })),
    );
    if (options.length) candidates[item.key] = options;
    else unavailable.push(item.label);
  }

  let active = intent.items.filter((i) => candidates[i.key]);
  if (!active.length) {
    return { message: "None of the approved items are in stock with delivery that fast. Try a later delivery time." };
  }

  // Drop optional items from the bottom of the priority list until the order fits the budget.
  const dropped: string[] = [];
  let best = cheapest(active, candidates);
  while (total(best.lines, best.merchants) > intent.budgetCapCents) {
    const optional = active.filter((i) => !i.essential);
    if (!optional.length || active.length === 1) {
      return {
        message:
          `The cheapest order I can build comes to ${fmt(total(best.lines, best.merchants))}, over your ${fmt(intent.budgetCapCents)} limit, ` +
          "so I didn't place it. Raise the budget or ask for fewer items.",
      };
    }
    const last = optional[optional.length - 1];
    active = active.filter((i) => i !== last);
    dropped.push(last.label);
    best = cheapest(active, candidates);
  }

  return {
    kitKey: intent.kit.key,
    kitLabel: intent.kit.label,
    urgency: intent.urgency,
    budgetCapCents: intent.budgetCapCents,
    lines: best.lines,
    merchants: best.merchants,
    dropped,
    unavailable,
    notes: [...intent.notes],
    singleStoreTotals: singleStoreTotals(active, candidates),
  };
}

const toCartMerchant = (q: MerchantQuote): CartMerchant => ({
  merchantId: q.merchantId,
  name: q.name,
  deliveryFeeCents: q.deliveryFeeCents,
  deliveryMinutes: q.deliveryMinutes,
});

function total(lines: CartLine[], merchants: CartMerchant[]) {
  return lines.reduce((s, l) => s + lineTotal(l), 0) + merchants.reduce((s, m) => s + m.deliveryFeeCents, 0);
}

function allMerchants(candidates: Record<string, Option[]>) {
  const out: Record<string, MerchantQuote> = {};
  for (const options of Object.values(candidates)) for (const o of options) out[o.quote.merchantId] = o.quote;
  return out;
}

function subsets<T>(xs: T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]).filter((s) => s.length);
}

// Tries every set of merchants and keeps the lowest total, counting delivery fees; ties go to fewer, faster merchants.
function cheapest(items: KitItem[], candidates: Record<string, Option[]>) {
  const merchants = allMerchants(candidates);
  let best: { lines: CartLine[]; merchants: CartMerchant[] } | null = null;
  let bestKey: number[] | null = null;
  for (const subset of subsets(Object.keys(merchants).sort())) {
    const lines = fill(items, candidates, new Set(subset));
    if (!lines) continue;
    const used = [...new Set(lines.map((l) => l.merchantId))].sort().map((id) => toCartMerchant(merchants[id]));
    const key = [total(lines, used), used.length, Math.max(...used.map((m) => m.deliveryMinutes))];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = { lines, merchants: used };
      bestKey = key;
    }
  }
  if (!best) throw new Error("every active item has at least one option");
  return best;
}

// What the order would cost from each merchant on its own, so the review can say what the chosen order saves.
function singleStoreTotals(items: KitItem[], candidates: Record<string, Option[]>) {
  return Object.values(allMerchants(candidates)).flatMap((quote) => {
    const lines = fill(items, candidates, new Set([quote.merchantId]));
    return lines ? [{ name: quote.name, totalCents: total(lines, [toCartMerchant(quote)]) }] : [];
  });
}

// The cheapest line for each item using only these merchants, or null if one of them can't supply an item.
function fill(items: KitItem[], candidates: Record<string, Option[]>, merchantIds: Set<string>): CartLine[] | null {
  const lines: CartLine[] = [];
  for (const item of items) {
    const options = candidates[item.key].filter((o) => merchantIds.has(o.quote.merchantId));
    if (!options.length) return null;
    const o = options.reduce((a, b) =>
      b.priceCents < a.priceCents ||
      (b.priceCents === a.priceCents &&
        (b.quote.deliveryMinutes < a.quote.deliveryMinutes || (b.quote.deliveryMinutes === a.quote.deliveryMinutes && b.sku < a.sku)))
        ? b
        : a,
    );
    lines.push({
      itemKey: item.key,
      itemLabel: item.label,
      sku: o.sku,
      productName: CATALOG[o.sku].name,
      qty: item.qty,
      unitPriceCents: o.priceCents,
      merchantId: o.quote.merchantId,
    });
  }
  return lines;
}
