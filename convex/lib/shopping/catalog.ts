// The product catalog and the user's approved-item profile (kits), from data.ts.
import { KITS, PRODUCTS, PROFILE } from "./data";

export type Product = {
  sku: string;
  name: string;
  brand: string;
  category: string;
  listPriceCents: number;
  rx: boolean;
  activeIngredient?: string;
  strength?: string;
  slot?: string; // prescription products: the kit item this would stand in for (e.g. a CGM sensor)
  keywords: string[];
};

export type KitItem = {
  key: string;
  label: string;
  match: Record<string, string>;
  qty: number;
  essential: boolean;
  keywords: string[];
  aqiEssential?: number; // becomes essential when live US AQI is at or above this (e.g. a HEPA filter on a smoky day)
};

export type Kit = { key: string; label: string; budgetCapCents: number; keywords: string[]; items: KitItem[] };

export const toCents = (dollars: number) => Math.round(dollars * 100);

export const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CATALOG: Record<string, Product> = Object.fromEntries(
  PRODUCTS.map((p) => [
    p.sku,
    {
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      category: p.category,
      listPriceCents: toCents(p.list_price),
      rx: p.rx,
      activeIngredient: p.active_ingredient,
      strength: p.strength,
      slot: p.slot,
      keywords: p.keywords ?? [],
    },
  ]),
);

export const KIT_LIST: Kit[] = Object.entries(KITS).map(([key, k]) => ({
  key,
  label: k.label,
  budgetCapCents: toCents(k.budget_cap),
  keywords: k.keywords,
  items: k.items.map((i) => ({
    key: i.key,
    label: i.label,
    match: i.match,
    qty: i.qty,
    essential: i.essential,
    keywords: i.keywords,
    aqiEssential: i.aqi_essential,
  })),
}));
export const KITS_BY_KEY: Record<string, Kit> = Object.fromEntries(KIT_LIST.map((k) => [k.key, k]));

export const DEFAULT_LOCATION = PROFILE.location;

const FIELD: Record<string, keyof Product> = {
  sku: "sku",
  brand: "brand",
  active_ingredient: "activeIngredient",
  strength: "strength",
};

// True only if the product equals the approved rule on every field the rule names (no substitutions).
export function matches(product: Product, rule: Record<string, string>) {
  return Object.entries(rule).every(([field, wanted]) => {
    const actual = product[FIELD[field] ?? (field as keyof Product)];
    return actual != null && String(actual).trim().toLowerCase() === wanted.trim().toLowerCase();
  });
}

// The only products this item may be filled with. Prescription products never qualify.
export const approvedSkus = (item: KitItem) =>
  Object.values(CATALOG)
    .filter((p) => !p.rx && matches(p, item.match))
    .map((p) => p.sku);

export const has = (text: string, words: string[]) => words.some((w) => text.includes(w));
