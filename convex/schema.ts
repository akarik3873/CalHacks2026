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
});
