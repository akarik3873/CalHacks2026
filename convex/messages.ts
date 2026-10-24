import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { step } from "./schema";

// Red flags get a fixed reply right away instead of going to the agent.
const RED_FLAGS = /chest pain|can'?t breathe|trouble breathing|fainted|passed out|face (is )?droop|slurred speech|suicid|kill myself|want to die|overdose/i;
const RED_FLAG_REPLY =
  "This could be an emergency. Please call 911 (or your local emergency number) now, or have someone take you to the nearest emergency room. If you're thinking about harming yourself, you can call or text 988 to reach the Suicide & Crisis Lifeline.";

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return recent.reverse();
  },
});

export const send = mutation({
  args: { userId: v.string(), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await ctx.db.insert("messages", { userId, role: "user", text: trimmed, status: "done" });

    if (RED_FLAGS.test(trimmed)) {
      await ctx.db.insert("messages", { userId, role: "assistant", text: RED_FLAG_REPLY, status: "done" });
      return;
    }

    const replyId = await ctx.db.insert("messages", { userId, role: "assistant", text: "", status: "thinking" });
    await ctx.scheduler.runAfter(0, internal.signal.answer, { userId, text: trimmed, replyId });
  },
});

export const latestConversationId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const replies = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    return replies.find((m) => m.conversationId)?.conversationId ?? null;
  },
});

export const finish = internalMutation({
  args: {
    replyId: v.id("messages"),
    text: v.string(),
    status: v.union(v.literal("done"), v.literal("error")),
    steps: v.optional(v.array(step)),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, { replyId, ...fields }) => {
    await ctx.db.patch(replyId, fields);
  },
});
