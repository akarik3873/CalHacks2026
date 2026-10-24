import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const step = v.object({
  type: v.string(),
  toolId: v.optional(v.string()),
  params: v.optional(v.any()),
  text: v.optional(v.string()),
});

export default defineSchema({
  messages: defineTable({
    userId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    status: v.union(v.literal("thinking"), v.literal("done"), v.literal("error")),
    // The Signal agent's tool trace, shown in the app so the user can check its work.
    steps: v.optional(v.array(step)),
    // Agent Builder conversation, reused so follow-up questions keep context.
    conversationId: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});
