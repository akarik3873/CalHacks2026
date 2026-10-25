// Voice for the app. Web streams TTS straight from Cartesia's WebSocket with a short-lived token from `token`;
// native plays `/tts`, an MP3 stream of one of the user's replies, since it has no way to play raw PCM.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, httpAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessToken, CARTESIA_VERSION, synthesizeMp3, voiceId } from "./lib/cartesia";
import { toSpeech } from "./lib/speech";

export const token = action({
  args: {},
  handler: async (ctx) => {
    if (!(await getAuthUserId(ctx))) throw new Error("Not signed in");
    return { token: await accessToken(), version: CARTESIA_VERSION, voiceId: voiceId() };
  },
});

// GET /tts?message=<id> with the Convex auth token as a Bearer header: speaks one of the caller's own replies.
export const ttsStream = httpAction(async (ctx, req) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return new Response("Not signed in", { status: 401 });
  const messageId = new URL(req.url).searchParams.get("message") ?? "";
  const text: string | null = await ctx.runQuery(internal.voice.spokenText, { userId, messageId });
  if (!text) return new Response("Not found", { status: 404 });
  try {
    const audio = await synthesizeMp3(text);
    return new Response(audio.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    console.error("tts stream failed", e);
    return new Response("Speech is unavailable right now", { status: 502 });
  }
});

// The speakable text of an assistant reply, only for the user it belongs to.
export const spokenText = internalQuery({
  args: { userId: v.id("users"), messageId: v.string() },
  handler: async (ctx, { userId, messageId }) => {
    const id = ctx.db.normalizeId("messages", messageId);
    const message = id ? await ctx.db.get(id) : null;
    if (!message || message.userId !== userId || message.role !== "assistant") return null;
    return toSpeech(message.text) || null;
  },
});
