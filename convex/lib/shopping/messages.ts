// What the user sees: the planned kit with a link per item at each store, and one link per store that fills a cart.
import { CATALOG, fmt } from "./catalog";
import { cartUrl, Listings, searchQuery, STORE_IDS, STORES } from "./links";
import { Cart, cartTotalCents } from "./planner";

export function linksText(cart: Cart, rxRefused: string[], listings: Listings) {
  const lines = [`**${cart.kitLabel}**: your approved items, about ${fmt(cartTotalCents(cart))} at list prices (your limit is ${fmt(cart.budgetCapCents)}).`, ""];
  for (const l of cart.lines) {
    const links = STORE_IDS.map((s) => `[${STORES[s].name}](${listings[l.sku]?.[s]?.url ?? STORES[s].search(searchQuery(CATALOG[l.sku]))})`);
    lines.push(`- ${l.itemLabel}: ${l.productName}${l.qty > 1 ? ` (${l.qty}x)` : ""}: ${links.join(" · ")}`);
  }

  const carts = STORE_IDS.flatMap((s) => {
    const items = cart.lines.flatMap((l) => {
      const id = listings[l.sku]?.[s]?.id;
      return id ? [{ id, qty: l.qty }] : [];
    });
    if (!items.length) return [];
    const missing = cart.lines.filter((l) => !listings[l.sku]?.[s]).map((l) => l.itemLabel);
    return [`- [Add all to your ${STORES[s].name} cart](${cartUrl(s, items)})${missing.length ? ` (without ${missing.join(", ")})` : ""}`];
  });
  if (carts.length) lines.push("", "**One-tap carts:**", ...carts);

  lines.push("");
  if (cart.dropped.length) lines.push(`Left out to stay under budget: ${cart.dropped.join(", ")}.`);
  if (rxRefused.length) lines.push(`Not included (prescription only): ${[...new Set(rxRefused)].join(", ")}.`);
  lines.push(...cart.notes, "Prices at the store may differ; shipping and tax are added at checkout. Nothing was bought: you check out yourself.");
  return lines.join("\n");
}
