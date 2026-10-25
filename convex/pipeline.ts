// The shared message pipeline for every channel (app + Telegram):
// embed -> vector search memory -> triage (small model) -> core model with tools -> reply.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { ChatMessage, complete, CORE_MODEL, TRIAGE_MODEL } from "./lib/cortex";
import { embed } from "./lib/jina";
import { analyzeSymptomsTool, runTool, saveLocationTool, toolDefs } from "./lib/tools";
import { parseInputs } from "./lib/creao";
import { sendTelegram, sendTyping } from "./lib/telegram";
import { channel } from "./schema";

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 12;

const SYSTEM_PROMPT = `You are a careful, friendly AI health assistant.
- Give clear, practical, evidence-based answers in plain words. Keep replies short unless asked for detail.
- You are not a doctor; for anything serious, recommend seeing a clinician.
- Use tools when you need current or specific info: web_search, read_page, bio_research (PubMed). Cite sources as links.
- Use the "Relevant past messages" to remember what the user told you before.
- If the user tells you where they are (city, zip, address), call save_location so you remember it.
- If the user asks what could be causing their symptoms, or wants a detailed analysis, call analyze_symptoms with what they told you. It runs in the background; tell them the report will arrive in a few minutes.
- Format with simple Markdown only: **bold**, *italic*, bullet lists, [links](url). No tables.`;

const URGENT_PROMPT = `TRIAGE FLAGGED THIS AS URGENT.
Start your reply with a clear warning: tell the user to seek care now and to call 911 (or local emergency number) if it could be life-threatening.
Then help them find nearby urgent care or an ER: if you know their location, use web_search to list a few nearby options; if not, ask for their city/zip (and save it with save_location).`;

export const respond = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.runQuery(internal.pipeline.getMessage, { messageId });
    if (!message) return;
    const { userId } = message;
    const user = await ctx.runQuery(internal.pipeline.getUser, { userId });
    // Telegram shows "typing…" for ~5s per call; re-sent before each slow step.
    const typing = () => {
      if (message.channel === "telegram" && user?.telegramChatId) {
        void sendTyping(user.telegramChatId).catch(() => {});
      }
    };
    typing();

    let reply: string;
    let urgent = false;
    try {
      // 1. Recent chat goes to the model as-is.
      const history = await ctx.runQuery(internal.pipeline.recent, { userId, limit: HISTORY_LIMIT });

      // 2. Embed + vector search for memory. Memory is only for older messages:
      // anything in the recent chat window, or newer than its oldest message, is skipped.
      let memory: Doc<"messages">[] = [];
      try {
        const vector = await embed(message.text);
        await ctx.runMutation(internal.pipeline.setEmbedding, { messageId, embedding: vector });
        const hits = await ctx.vectorSearch("messages", "by_embedding", {
          vector,
          limit: 8,
          filter: (q) => q.eq("userId", userId),
        });
        const ids = hits.filter((h) => h._id !== messageId && h._score > 0.5).map((h) => h._id);
        const windowStart = history[0]?._creationTime ?? message._creationTime;
        const inHistory = new Set(history.map((m) => m._id));
        memory = (await ctx.runQuery(internal.pipeline.getMessages, { ids })).filter(
          (m) => !inHistory.has(m._id) && m._creationTime < windowStart,
        );
      } catch (e) {
        console.error("memory step failed", e);
      }

      // 3. Triage with the small model.
      const triage = await runTriage(message.text);
      urgent = triage.urgent;

      // 4. Core model with tools.
      reply = await runCore({
        message,
        memory,
        history,
        triage,
        location: user?.location,
        typing,
        saveLocation: (location) =>
          ctx.runMutation(internal.pipeline.saveLocation, { userId, location }),
        analyzeSymptoms: async (rawArgs) => {
          const parsed = parseInputs(rawArgs);
          if ("error" in parsed) return `Tool error: ${parsed.error}`;
          return ctx.runMutation(internal.creao.request, { userId, channel: message.channel, inputs: parsed.inputs });
        },
      });
    } catch (e) {
      console.error("pipeline failed", e);
      reply = "Sorry, something went wrong on my end. Please try again in a moment.";
    }

    await ctx.runMutation(internal.pipeline.saveReply, {
      userId,
      text: reply,
      channel: message.channel,
      urgent,
    });
  },
});

async function runTriage(text: string): Promise<{ medical: boolean; urgent: boolean }> {
  try {
    const { content } = await complete({
      model: TRIAGE_MODEL(),
      maxTokens: 50,
      messages: [
        {
          role: "system",
          content:
            'Classify the user message. Reply with ONLY JSON: {"medical": boolean, "urgent": boolean}. ' +
            "urgent = possible emergency needing care now (e.g. chest pain, trouble breathing, stroke signs, severe bleeding, suicidal thoughts, overdose, anaphylaxis).",
        },
        { role: "user", content: text },
      ],
    });
    const json = JSON.parse(content?.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { medical: !!json.medical, urgent: !!json.urgent };
  } catch (e) {
    console.error("triage failed", e);
    return { medical: true, urgent: false };
  }
}

async function runCore(opts: {
  message: Doc<"messages">;
  memory: Doc<"messages">[];
  history: Doc<"messages">[];
  triage: { medical: boolean; urgent: boolean };
  location?: string;
  typing: () => void;
  saveLocation: (location: string) => Promise<null>;
  analyzeSymptoms: (rawArgs: string) => Promise<string>;
}): Promise<string> {
  const { message, memory, history, triage, location } = opts;
  const system = [SYSTEM_PROMPT];
  if (location) system.push(`User's saved location: ${location}`);
  if (memory.length) {
    system.push(
      "Relevant past messages:\n" + memory.map((m) => `- [${m.role}] ${m.text}`).join("\n"),
    );
  }
  if (triage.urgent) system.push(URGENT_PROMPT);

  const messages: ChatMessage[] = [
    { role: "system", content: system.join("\n\n") },
    ...history
      .filter((m) => m._id !== message._id)
      .map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
    { role: "user", content: message.text },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { content, toolCalls } = await complete({
      model: CORE_MODEL(),
      messages,
      tools: [...toolDefs, saveLocationTool, analyzeSymptomsTool],
    });
    if (!toolCalls.length) return content?.trim() || "Sorry, I don't have an answer for that.";
    opts.typing();
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let result: string;
      if (call.function.name === "save_location") {
        result = await runSaveLocation(call.function.arguments, opts.saveLocation);
      } else if (call.function.name === "analyze_symptoms") {
        result = await opts.analyzeSymptoms(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else {
        result = await runTool(call.function.name, call.function.arguments);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  // Out of tool rounds: ask for a final answer without tools.
  const { content } = await complete({ model: CORE_MODEL(), messages });
  return content?.trim() || "Sorry, I couldn't finish researching that.";
}

async function runSaveLocation(rawArgs: string, save: (location: string) => Promise<null>) {
  try {
    const location = String(JSON.parse(rawArgs || "{}").location ?? "").trim().slice(0, 200);
    if (!location) return "Tool error: location is empty";
    await save(location);
    return `Saved location: ${location}`;
  } catch (e) {
    return `Tool error: ${(e as Error).message}`;
  }
}

export const saveLocation = internalMutation({
  args: { userId: v.id("users"), location: v.string() },
  handler: async (ctx, { userId, location }) => {
    await ctx.db.patch(userId, { location });
    return null;
  },
});

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: (ctx, { messageId }) => ctx.db.get(messageId),
});

export const getMessages = internalQuery({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, { ids }) =>
    (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((m) => m !== null),
});

export const recent = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) =>
    (
      await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit)
    ).reverse(),
});

export const setEmbedding = internalMutation({
  args: { messageId: v.id("messages"), embedding: v.array(v.float64()) },
  handler: (ctx, { messageId, embedding }) => ctx.db.patch(messageId, { embedding }),
});

export const saveReply = internalMutation({
  args: { userId: v.id("users"), text: v.string(), channel, urgent: v.boolean() },
  handler: (ctx, args) => saveAssistantReply(ctx, args),
});

// Store an assistant message, embed it, and send it on Telegram if that's where the user is.
// Also used for replies that arrive later, like CREAO analysis reports.
export async function saveAssistantReply(
  ctx: MutationCtx,
  args: { userId: Id<"users">; text: string; channel: "app" | "telegram"; urgent: boolean },
) {
  const messageId = await ctx.db.insert("messages", { ...args, role: "assistant" });
  await ctx.scheduler.runAfter(0, internal.pipeline.embedReply, { messageId });
  if (args.channel === "telegram") {
    await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, {
      userId: args.userId,
      text: args.text,
    });
  }
}

// Store an embedding for assistant replies too, so they show up in memory search.
export const embedReply = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.runQuery(internal.pipeline.getMessage, { messageId });
    if (!message) return;
    const embedding = await embed(message.text);
    await ctx.runMutation(internal.pipeline.setEmbedding, { messageId, embedding });
  },
});

export const deliverTelegram = internalAction({
  args: { userId: v.id("users"), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const user = await ctx.runQuery(internal.pipeline.getUser, { userId });
    if (user?.telegramChatId) await sendTelegram(user.telegramChatId, text);
  },
});

export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => ctx.db.get(userId),
});

// Per-user cap on messages to the model (app + Telegram combined), over a rolling 24 hours.
export const DAILY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
export const LIMIT_REPLY = `You've reached today's limit of ${DAILY_LIMIT} messages. Please try again tomorrow. If this is an emergency, call 911.`;

// Insert a user message and kick off the pipeline. Shared by app + Telegram entry points.
// Returns null (and stores nothing) when the user is over the daily limit.
export async function enqueueUserMessage(
  ctx: MutationCtx,
  userId: Id<"users">,
  text: string,
  ch: "app" | "telegram",
) {
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.now() - DAY_MS))
    .filter((q) => q.eq(q.field("role"), "user"))
    .take(DAILY_LIMIT);
  if (recent.length >= DAILY_LIMIT) return null;
  const messageId = await ctx.db.insert("messages", { userId, role: "user", text, channel: ch });
  await ctx.scheduler.runAfter(0, internal.pipeline.respond, { messageId });
  return messageId;
}
