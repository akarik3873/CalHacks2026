// Telegram bot: account linking + incoming messages (called from the /telegram webhook).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { audioFileName, downloadFile, finishLinkPrompt, sendLinkPrompt, sendTelegram, sendTyping } from "./lib/telegram";
import { transcribe } from "./lib/cartesia";
import { internal } from "./_generated/api";
import { enqueueUserMessage, LIMIT_REPLY, overDailyLimit } from "./pipeline";

const LINK_TTL_MS = 15 * 60 * 1000;
const WELCOME =
  "Hi! I'm Wellnest, your AI health assistant. Text me any health question, or send a voice note and I'll answer out loud too. I'm not a doctor; in an emergency call 911.";

// App user taps "Text me on Telegram" -> gets t.me/<bot>?start=<code>.
export const createLinkUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const bot = process.env.TELEGRAM_BOT_USERNAME;
    if (!bot) throw new Error("TELEGRAM_BOT_USERNAME is not set");
    const code = crypto.randomUUID().replace(/-/g, "");
    await ctx.db.insert("telegramLinks", { code, userId, expiresAt: Date.now() + LINK_TTL_MS });
    return `https://t.me/${bot}?start=${code}`;
  },
});

export const handleIncoming = internalMutation({
  args: { chatId: v.string(), text: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { chatId, text, name }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_telegram", (q) => q.eq("telegramChatId", chatId))
      .unique();

    const start = text.match(/^\/start(?:\s+(\S+))?/);
    if (start) {
      const link = start[1]
        ? await ctx.db
            .query("telegramLinks")
            .withIndex("by_code", (q) => q.eq("code", start[1]))
            .unique()
        : null;
      if (link && link.expiresAt > Date.now()) {
        // Don't link yet: the person in this chat must confirm which account they're joining,
        // so a link sent by someone else can't silently attach this chat to their account.
        const owner = await ctx.db.get(link.userId);
        await ctx.db.patch(link._id, { pendingChatId: chatId });
        await ctx.scheduler.runAfter(0, internal.telegram.sendLinkPromptAction, {
          chatId,
          linkId: link._id,
          text: `Link this Telegram chat to the app account ${maskEmail(owner?.email)}?\n\nOnly tap Yes if that's your account. Whoever owns it will see your messages here.`,
        });
        return;
      }
      const userId = existing?._id ?? (await findOrCreateTelegramUser(ctx, chatId, name));
      await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, {
        userId,
        text: start[1]
          ? `That link has expired. Tap "Text me on Telegram" in the app to get a new one.\n\n${WELCOME}`
          : WELCOME,
      });
      return;
    }

    // Telegram-only users: first message creates the account.
    const userId = existing?._id ?? (await findOrCreateTelegramUser(ctx, chatId, name));
    const messageId = await enqueueUserMessage(ctx, userId, text.slice(0, 4000), "telegram");
    if (messageId === null) {
      await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, { userId, text: LIMIT_REPLY });
    }
  },
});

// Voice notes: checked here (daily limit, length) before any audio is downloaded or sent to Cartesia.
const MAX_VOICE_SECONDS = 180;
const VOICE_TOO_LONG = "That voice note is over 3 minutes. Please send a shorter one, or type your question.";
const VOICE_UNREADABLE = "Sorry, I couldn't listen to that voice note. Please try again, or type your question.";
const VOICE_EMPTY = "I couldn't make out any words in that voice note. Could you try again, or type it?";

export const handleVoice = internalMutation({
  args: {
    chatId: v.string(),
    name: v.optional(v.string()),
    fileId: v.string(),
    duration: v.number(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, { chatId, name, fileId, duration, mimeType }) => {
    const userId = await findOrCreateTelegramUser(ctx, chatId, name);
    const reply = (text: string) => ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, { userId, text });
    if (await overDailyLimit(ctx, userId)) {
      await reply(LIMIT_REPLY);
      return;
    }
    if (duration > MAX_VOICE_SECONDS) {
      await reply(VOICE_TOO_LONG);
      return;
    }
    await ctx.scheduler.runAfter(0, internal.telegram.transcribeVoice, { userId, chatId, fileId, mimeType });
  },
});

// Download the voice note, transcribe it with Cartesia (ink-whisper), and run the transcript like a text message.
export const transcribeVoice = internalAction({
  args: { userId: v.id("users"), chatId: v.string(), fileId: v.string(), mimeType: v.optional(v.string()) },
  handler: async (ctx, { userId, chatId, fileId, mimeType }) => {
    void sendTyping(chatId).catch(() => {});
    let text: string;
    try {
      const { audio, path } = await downloadFile(fileId);
      text = await transcribe(audio, audioFileName(path, mimeType));
    } catch (e) {
      console.error("voice note transcription failed", e);
      await sendTelegram(chatId, VOICE_UNREADABLE);
      return;
    }
    if (!text) {
      await sendTelegram(chatId, VOICE_EMPTY);
      return;
    }
    await ctx.runMutation(internal.telegram.enqueueVoiceNote, { userId, text });
  },
});

export const enqueueVoiceNote = internalMutation({
  args: { userId: v.id("users"), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const messageId = await enqueueUserMessage(ctx, userId, text.slice(0, 4000), "telegram", true);
    if (messageId === null) {
      await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, { userId, text: LIMIT_REPLY });
    }
  },
});

// Yes/No button pressed on the link prompt.
export const handleLinkDecision = internalMutation({
  args: {
    chatId: v.string(),
    callbackId: v.string(),
    messageId: v.optional(v.number()),
    data: v.string(),
  },
  handler: async (ctx, { chatId, callbackId, messageId, data }) => {
    const finish = (text: string) =>
      ctx.scheduler.runAfter(0, internal.telegram.finishLinkPromptAction, {
        callbackId,
        chatId,
        messageId,
        text,
      });
    const match = data.match(/^link:(yes|no):(.+)$/);
    const linkId = match && ctx.db.normalizeId("telegramLinks", match[2]);
    const link = linkId ? await ctx.db.get(linkId) : null;
    // The decision only counts from the chat that pressed Start, before the code expires.
    if (!match || !link || link.pendingChatId !== chatId || link.expiresAt <= Date.now()) {
      await finish(`This link is no longer valid. Tap "Text me on Telegram" in the app to get a new one.`);
      return;
    }
    await ctx.db.delete(link._id);
    if (match[1] === "no") {
      await finish("Okay, not linked. You can still text me here.");
      return;
    }
    await linkChat(ctx, chatId, link.userId);
    await finish(`Linked to your app account. ${WELCOME}`);
  },
});

async function linkChat(ctx: MutationCtx, chatId: string, userId: Id<"users">) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_telegram", (q) => q.eq("telegramChatId", chatId))
    .unique();
  if (existing && existing._id !== userId) {
    await ctx.db.patch(existing._id, { telegramChatId: undefined });
    // Only fold in an auto-created Telegram-only account; never move another app account's history.
    if (!existing.email) {
      const old = await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", existing._id))
        .collect();
      for (const m of old) await ctx.db.patch(m._id, { userId });
      await ctx.db.delete(existing._id);
    }
  }
  await ctx.db.patch(userId, { telegramChatId: chatId });
}

// "jane@gmail.com" -> "j***@gmail.com"
function maskEmail(email?: string) {
  if (!email) return "(no email)";
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export const sendLinkPromptAction = internalAction({
  args: { chatId: v.string(), linkId: v.id("telegramLinks"), text: v.string() },
  handler: (_ctx, { chatId, linkId, text }) => sendLinkPrompt(chatId, text, linkId),
});

export const finishLinkPromptAction = internalAction({
  args: {
    callbackId: v.string(),
    chatId: v.string(),
    messageId: v.optional(v.number()),
    text: v.string(),
  },
  handler: (_ctx, args) => finishLinkPrompt(args),
});

// User shared a location pin in Telegram: remember it for urgent care lookups.
export const saveSharedLocation = internalMutation({
  args: { chatId: v.string(), name: v.optional(v.string()), lat: v.number(), lon: v.number() },
  handler: async (ctx, { chatId, name, lat, lon }) => {
    const userId = await findOrCreateTelegramUser(ctx, chatId, name);
    await ctx.db.patch(userId, { location: `${lat.toFixed(4)},${lon.toFixed(4)}` });
    await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, {
      userId,
      text: "Got it, I saved your location for finding nearby care.",
    });
  },
});

// Daily cron: drop link codes that were never used.
export const deleteExpiredLinks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("telegramLinks")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const link of expired) await ctx.db.delete(link._id);
  },
});

async function findOrCreateTelegramUser(ctx: MutationCtx, chatId: string, name?: string) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_telegram", (q) => q.eq("telegramChatId", chatId))
    .unique();
  return existing?._id ?? (await ctx.db.insert("users", { name, telegramChatId: chatId }));
}
