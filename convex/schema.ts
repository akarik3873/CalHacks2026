import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// jina-embeddings-v3 default output size.
export const EMBEDDING_DIMS = 1024;

export const channel = v.union(v.literal("app"), v.literal("telegram"));
export const role = v.union(v.literal("user"), v.literal("assistant"));

// Form fields of the CREAO symptom analyzer agent (creao/config.yaml).
export const creaoInputs = v.object({
  symptoms: v.string(),
  symptom_duration: v.optional(v.string()),
  age: v.optional(v.number()),
  sex: v.optional(v.union(v.literal("female"), v.literal("male"), v.literal("other"), v.literal("unspecified"))),
  chronic_conditions: v.optional(v.string()),
  biosensor_data: v.optional(v.string()),
  cycle_data: v.optional(v.string()),
  last_period_start: v.optional(v.string()),
});

// "starting" is ours (before CREAO accepts the run); the rest are CREAO's run states.
export const creaoRunStatus = v.union(
  v.literal("starting"),
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

// Health Supply Shopper (convex/shop.ts).
export const urgency = v.union(v.literal("asap"), v.literal("today"), v.literal("standard"));
const cartLine = v.object({
  itemKey: v.string(),
  itemLabel: v.string(),
  sku: v.string(),
  productName: v.string(),
  qty: v.number(),
  unitPriceCents: v.number(),
  merchantId: v.string(),
});
// Legacy: a cart priced by the removed headless browser service.
export const realStore = v.object({
  store: v.string(),
  storeName: v.string(),
  canFillCart: v.boolean(),
  products: v.array(v.object({ sku: v.string(), id: v.string(), url: v.string(), title: v.string() })),
});
const cartMerchant = v.object({
  merchantId: v.string(),
  name: v.string(),
  deliveryFeeCents: v.number(),
  deliveryMinutes: v.number(),
});

export default defineSchema({
  ...authTables,
  // Override Convex Auth's users table to add our own fields.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    telegramChatId: v.optional(v.string()),
    voiceMode: v.optional(v.boolean()),
    // Free text ("Berkeley, CA 94704") or "lat,lon" from a shared Telegram location.
    location: v.optional(v.string()),
    // Routing state (convex/pipeline.ts): an analysis offer waiting for a yes.
    analysisOfferedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_telegram", ["telegramChatId"]),

  messages: defineTable({
    userId: v.id("users"),
    role,
    text: v.string(),
    channel,
    embedding: v.optional(v.array(v.float64())),
    urgent: v.optional(v.boolean()),
    // "links": the shopper's store links under a reply. Shown, but never read aloud in voice mode.
    kind: v.optional(v.literal("links")),
  })
    .index("by_user", ["userId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMS,
      filterFields: ["userId"],
    }),

  // One-time codes for t.me/<bot>?start=<code> account linking.
  telegramLinks: defineTable({
    code: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
    // Telegram chat that pressed Start with this code and is being asked to confirm.
    pendingChatId: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_expires", ["expiresAt"]),

  // Detailed symptom analyses run by the CREAO agent (convex/creao.ts).
  creaoRuns: defineTable({
    userId: v.id("users"),
    channel,
    inputs: creaoInputs,
    status: creaoRunStatus,
    runId: v.optional(v.string()), // CREAO's run id, once it accepts the run
    polls: v.number(),
    delivered: v.boolean(), // the user has been sent the report (or the failure notice)
    report: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_run", ["runId"]),

  // Legacy, no longer written: orders from the removed approve-then-fill-a-cart flow. Kept because the dev deployment still has rows.
  carts: defineTable({
    userId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("cancelled")),
    expiresAt: v.number(),
    kitKey: v.string(),
    kitLabel: v.string(),
    urgency,
    budgetCapCents: v.number(),
    lines: v.array(cartLine),
    merchants: v.array(cartMerchant),
    dropped: v.array(v.string()),
    unavailable: v.array(v.string()),
    notes: v.array(v.string()),
    rxRefused: v.array(v.string()),
    singleStoreTotals: v.array(v.object({ name: v.string(), totalCents: v.number() })),
    real: v.optional(realStore), // always set on new carts; missing only on old simulated-store carts
  }).index("by_user_status", ["userId", "status"]),

  // Legacy, no longer written: the removed simulated card network. Kept because the dev deployment still has rows.
  cardAuths: defineTable({
    authId: v.string(),
    amountCents: v.number(),
    merchantId: v.string(),
    reference: v.string(),
    status: v.union(v.literal("authorized"), v.literal("captured"), v.literal("voided")),
  }).index("by_auth", ["authId"]),

  // Legacy, no longer written: orders from the removed simulated merchants. Kept because the dev deployment still has rows.
  shopOrders: defineTable({
    userId: v.id("users"),
    cartId: v.id("carts"),
    merchantId: v.string(),
    merchant: v.string(),
    orderId: v.string(),
    status: v.union(v.literal("paid"), v.literal("failed")),
    authId: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    etaMinutes: v.optional(v.number()),
    items: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
