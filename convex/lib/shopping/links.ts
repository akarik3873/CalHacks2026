// Store links for a planned cart, found with Jina web search (lib/jina.ts); no store page is loaded or scraped.
// Each approved product's Amazon and Walmart listing, then one link per store that adds every item to the user's own cart.
// A product with no matching listing gets a store search link instead. The user checks out themselves.
import { search } from "../jina";
import { CATALOG, Product } from "./catalog";
import { CartLine } from "./planner";

// Online delivery isn't known until checkout; plan with a standard 2-day estimate.
export const DELIVERY_MINUTES = 2 * 24 * 60;

export type StoreId = "amazon" | "walmart";
export type Listing = { id: string; url: string; title: string };
// Per cart line (by sku), the listing found at each store, if any.
export type Listings = Record<string, Partial<Record<StoreId, Listing>>>;

export const STORES: Record<StoreId, { name: string; site: string; id: RegExp; product: (id: string) => string; search: (q: string) => string }> = {
  amazon: {
    name: "Amazon",
    site: "https://www.amazon.com",
    id: /amazon\.com\/(?:[^?#]*\/)?(?:dp|clp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/,
    product: (id) => `https://www.amazon.com/dp/${id}`,
    search: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  walmart: {
    name: "Walmart",
    site: "https://www.walmart.com",
    id: /walmart\.com\/ip\/(?:[^/?#]+\/)?(\d{5,})(?:[/?#]|$)/,
    product: (id) => `https://www.walmart.com/ip/${id}`,
    search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  },
};
export const STORE_IDS = Object.keys(STORES) as StoreId[];

// The product name to search for, with the brand in front when the name leaves it out.
export function searchQuery(p: Product) {
  const name = p.name.replace(/\(store brand\)/i, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const brand = p.brand === "Store brand" || compact(name).includes(compact(p.brand)) ? "" : `${p.brand} `;
  return brand + name;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");

// Does this listing look like the approved product? Brand (or active ingredient for store brand) and strength must match.
export function matchesProduct(p: Product, title: string) {
  const t = compact(title);
  const name = p.brand === "Store brand" ? p.activeIngredient : p.brand;
  if (name && !t.includes(compact(name))) return false;
  return !p.strength || t.includes(compact(p.strength));
}

// The first search result at the store that is a product page for this product. A failed search finds nothing.
async function findListing(store: StoreId, p: Product): Promise<Listing | undefined> {
  const results = await search(searchQuery(p), STORES[store].site).catch((e) => {
    console.error(`${store} search failed for ${p.sku}`, e);
    return [];
  });
  for (const r of results) {
    const id = r.url.match(STORES[store].id)?.[1];
    if (id && matchesProduct(p, r.title)) return { id, url: STORES[store].product(id), title: r.title };
  }
}

export async function findListings(lines: CartLine[]): Promise<Listings> {
  const found = await Promise.all(
    lines.flatMap((l) => STORE_IDS.map(async (store) => [l.sku, store, await findListing(store, CATALOG[l.sku])] as const)),
  );
  const out: Listings = {};
  for (const [sku, store, listing] of found) if (listing) (out[sku] ??= {})[store] = listing;
  return out;
}

// A link that adds these items to the user's own cart at the store.
export function cartUrl(store: StoreId, items: { id: string; qty: number }[]) {
  if (store === "amazon") {
    return "https://www.amazon.com/gp/aws/cart/add.html?" + items.map(({ id, qty }, i) => `ASIN.${i + 1}=${id}&Quantity.${i + 1}=${qty}`).join("&");
  }
  return "https://affil.walmart.com/cart/addToCart?items=" + items.map(({ id, qty }) => `${id}%7C${qty}`).join(",");
}
