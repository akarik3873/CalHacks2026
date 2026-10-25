/// <reference types="vite/client" />
// Test helpers: a convex-test instance plus a fake for every outside API (Cortex, Jina, Telegram, Cartesia).
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../convex/schema";
import { Id } from "../convex/_generated/dataModel";

export const modules = import.meta.glob(["../convex/**/*.ts", "../convex/_generated/*.js", "!../convex/**/*.d.ts"]);

export function setup() {
  return convexTest(schema, modules);
}

export type Call = { url: string; init?: RequestInit; body?: any };

type CortexReply = { content?: string | null; tool_calls?: any[] } | Error;

// Embeddings: words map to fixed dimensions, so texts sharing words are "similar".
export function fakeEmbedding(text: string): number[] {
  const v = new Array(1024).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 1024;
    v[h] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

// A CREAO run as GET /runs/:id returns it. Successive polls take the next entry; the last one repeats.
export type CreaoRunReply = { status: string; result?: { text?: string; chatText?: string }; errorCode?: string };

export function mockApis(opts: {
  triage?: CortexReply | ((body: any) => CortexReply);
  core?: CortexReply[];
  jinaEmbedFail?: boolean;
  telegramRejectHtml?: boolean;
  creaoStartFail?: boolean;
  creaoRuns?: CreaoRunReply[];
} = {}) {
  const calls: Call[] = [];
  const core = [...(opts.core ?? [{ content: "Rest and drink water." }])];
  const creaoRuns = [...(opts.creaoRuns ?? [{ status: "completed", result: { text: "## What the symptoms and data suggest\nReport." } }])];
  const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    let body: any;
    try {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    } catch {
      body = init?.body;
    }
    calls.push({ url, init, body });

    if (url.includes("snowflakecomputing.com")) {
      const isTriage = body.model === (process.env.CORTEX_TRIAGE_MODEL ?? "llama3.1-8b");
      let reply: CortexReply;
      if (isTriage) {
        const t = opts.triage ?? { content: '{"medical": true, "urgent": false}' };
        reply = typeof t === "function" ? t(body) : t;
      } else {
        reply = core.shift() ?? { content: "fallback final" };
      }
      if (reply instanceof Error) return new Response(reply.message, { status: 500 });
      return Response.json({ choices: [{ message: { role: "assistant", ...reply } }] });
    }
    if (url === "https://api.jina.ai/v1/embeddings") {
      if (opts.jinaEmbedFail) return new Response("down", { status: 503 });
      return Response.json({ data: [{ embedding: fakeEmbedding(body.input[0]) }] });
    }
    if (url.startsWith("https://s.jina.ai/")) {
      return Response.json({
        data: [{ title: "Urgent care near 94704", url: "https://example.com/uc", description: "Open 24/7" }],
      });
    }
    if (url.startsWith("https://r.jina.ai/")) return new Response("Page text about the topic.");
    if (url.startsWith("https://api.telegram.org/")) {
      if (opts.telegramRejectHtml && body?.parse_mode === "HTML") {
        return new Response("Bad Request: can't parse entities", { status: 400 });
      }
      return Response.json({ ok: true });
    }
    if (url === "https://api.cartesia.ai/access-token") return Response.json({ token: "tok_123" });
    if (url.startsWith("https://agent.creao.ai/api/v1/apps/")) {
      if (init?.method === "POST") {
        if (opts.creaoStartFail) return new Response("insufficient credits", { status: 402 });
        return Response.json({ id: "run_1", status: "pending", appId: "app", appName: "Symptom & Biosensor Health Analyzer" });
      }
      const next = creaoRuns.length > 1 ? creaoRuns.shift()! : creaoRuns[0];
      return Response.json({ id: url.split("/runs/")[1], ...next });
    }
    return new Response(`unmocked ${url}`, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export function setEnv() {
  vi.stubEnv("SNOWFLAKE_ACCOUNT_URL", "https://acme.snowflakecomputing.com/");
  vi.stubEnv("SNOWFLAKE_PAT", "pat_test");
  vi.stubEnv("JINA_API_KEY", "jina_test");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot_test");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "HealthBot");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "s3cret");
  vi.stubEnv("CARTESIA_API_KEY", "cartesia_test");
}

export async function createAppUser(t: ReturnType<typeof setup>, email = "a@example.com") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

export const cortexCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("snowflakecomputing"));
export const creaoStarts = (calls: Call[]) => calls.filter((c) => c.url.includes("agent.creao.ai") && c.init?.method === "POST");
export const creaoPolls = (calls: Call[]) => calls.filter((c) => c.url.includes("agent.creao.ai") && c.init?.method !== "POST");
export const telegramSends = (calls: Call[]) => calls.filter((c) => c.url.includes("api.telegram.org") && c.url.endsWith("/sendMessage"));
export const telegramTyping = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/sendChatAction"));

export async function drain(t: ReturnType<typeof setup>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

export function messagesOf(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.run((ctx) =>
    ctx.db.query("messages").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
  );
}
