// App/web entry points: send + list messages, user settings.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { DAILY_LIMIT, enqueueUserMessage } from "./pipeline";

export const send = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trimmed = text.trim();
    if (!trimmed) return { limited: false };
    const messageId = await enqueueUserMessage(ctx, userId, trimmed.slice(0, 4000), "app");
    return { limited: messageId === null, limit: DAILY_LIMIT };
  },
});

// Shows every message for the user, including ones sent on Telegram.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return messages.reverse().map(({ embedding, ...m }) => m);
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      email: user.email ?? null,
      voiceMode: user.voiceMode ?? true, // voice is on until the user turns it off
      location: user.location ?? "",
      telegramLinked: !!user.telegramChatId,
    };
  },
});

export const setVoiceMode = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { voiceMode: enabled });
  },
});

export const setLocation = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trimmed = location.trim().slice(0, 200);
    await ctx.db.patch(userId, { location: trimmed || undefined });
  },
});
