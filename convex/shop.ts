// Health Supply Shopper: finds over-the-counter health supplies for the user.
// request -> Snowflake reads it (rules as backup) -> cheapest approved kit within the budget at list prices
// -> Amazon and Walmart links for each item plus one-tap cart links (lib/shopping/links.ts). Nothing is bought: the user checks out.
// Called from the pipeline (convex/pipeline.ts) when Jev says the message needs supplies.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { adjustForAirQuality, CITES_BAD_AIR, fetchAirQuality } from "./lib/shopping/airquality";
import { CATALOG, DEFAULT_LOCATION } from "./lib/shopping/catalog";
import { checkCart, GuardrailError } from "./lib/shopping/guardrails";
import { DELIVERY_MINUTES, findListings } from "./lib/shopping/links";
import { linksText } from "./lib/shopping/messages";
import { MerchantQuote, planCart } from "./lib/shopping/planner";
import { ModelCall, understandRequest } from "./lib/shopping/understanding";

export type ShopKind = "links" | "clarify" | "refuse" | "emergency" | "no_cart" | "error";
// kind "links" = the kit with store links, shown to the user after the assistant's reply.
export type ShopResult = { text: string; kind: ShopKind };

// Every approved product at its list price: the plan picks items and keeps the budget; the stores set the real price.
const LIST_PRICES: MerchantQuote = {
  merchantId: "online",
  name: "Online",
  deliveryFeeCents: 0,
  deliveryMinutes: DELIVERY_MINUTES,
  offers: Object.fromEntries(Object.values(CATALOG).filter((p) => !p.rx).map((p) => [p.sku, { priceCents: p.listPriceCents, stock: 99 }])),
};

// One turn with the shopper. modelCall is swappable for tests.
export async function shopTurn(text: string, modelCall?: ModelCall): Promise<ShopResult> {
  let intent = await understandRequest(text, modelCall);
  if (intent.type !== "order") return { text: intent.message, kind: intent.type };
  if (intent.kit.key === "allergy") {
    const reading = await fetchAirQuality(intent.location ?? DEFAULT_LOCATION);
    intent = adjustForAirQuality(intent, reading, CITES_BAD_AIR.test(text));
  }
  if (intent.urgency !== "standard") {
    // Online delivery dates are only known at checkout; plan for standard delivery and say so.
    intent = { ...intent, urgency: "standard", notes: [...intent.notes, "Online stores can't promise delivery that fast. If you need it now, a pharmacy run is quicker."] };
  }

  const plan = planCart(intent, [LIST_PRICES]);
  if (!("lines" in plan)) {
    const extra = intent.rxRefused.length ? [`Not included (prescription only): ${[...new Set(intent.rxRefused)].join(", ")}.`] : [];
    return { text: [plan.message, ...intent.notes, ...extra].join("\n"), kind: "no_cart" };
  }
  try {
    checkCart(plan, intent.kit);
  } catch (e) {
    if (!(e instanceof GuardrailError)) throw e;
    console.error("planner produced a cart that fails the guardrails", e);
    return { text: `I couldn't put together items that follow your rules (${e.message}).`, kind: "no_cart" };
  }
  return { text: linksText(plan, intent.rxRefused, await findListings(plan.lines)), kind: "links" };
}

// Talk to the shopper directly (tests, or `npx convex run shop:chat`).
export const chat = internalAction({
  args: { text: v.string() },
  handler: (_ctx, { text }): Promise<ShopResult> => shopTurn(text),
});
