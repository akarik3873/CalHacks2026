/// <reference types="vite/client" />
// Test helpers: a convex-test instance plus a fake for every outside API (Cortex, Jina, Telegram, Cartesia,
// CREAO, Jev, Open-Meteo).
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
export type CreaoRunReply = {
  status: string;
  result?: { text?: string; chatText?: string; artifacts?: { url: string; type: string; title: string }[] };
  errorCode?: string | null;
};
export const CREAO_REPORT_URL = "https://agent.creao.ai/api/v1/runs/run_1/artifacts/download?artifactId=files%2Freport.md";

// Jev answers: the probability for each yes/no question it's asked. Unset questions come back as 0.05.
export type JevAnswers = Partial<Record<"urgent" | "needs_supplies" | "wants_analysis" | "consent", number>>;

// Store product search (Jina with X-Site amazon.com / walmart.com): one listing per query, its title the query itself,
// with an id derived from the query, so every approved product is found. Return [] from `shopSearch` for "not listed".
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const fakeAsin = (q: string) => `B0${hash(q).toString(36).toUpperCase().padStart(8, "0").slice(0, 8)}`;
export const fakeWalmartId = (q: string) => String(hash(q) % 900_000_000 + 100_000);
export function storeListing(site: string, q: string) {
  return site.includes("amazon")
    ? { title: q, url: `https://www.amazon.com/Some-Product/dp/${fakeAsin(q)}/ref=sr_1_1` }
    : { title: q, url: `https://www.walmart.com/ip/Some-Product/${fakeWalmartId(q)}` };
}

// What the fake Cartesia TTS returns: an MP3 frame header and a few bytes.
export const FAKE_MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);

export function mockApis(opts: {
  core?: CortexReply[];
  jinaEmbedFail?: boolean;
  telegramRejectHtml?: boolean;
  creaoStartFail?: boolean;
  creaoRuns?: CreaoRunReply[];
  jev?: JevAnswers | ((body: any) => JevAnswers) | Error;
  aqi?: number | null; // live US AQI from Open-Meteo; null = place not found
  // The shopper's Snowflake reading of a request, or a function of the request text (default: no JSON -> keyword rules).
  shopperModel?: string | Error | ((text: string) => string | undefined);
  // Store product search results for (site, query); default storeListing. An Error = Jina search down for stores.
  shopSearch?: Error | ((site: string, q: string) => { title: string; url: string }[]);
  cartesiaTtsFail?: boolean; // /tts/bytes answers 500
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
      if (body.messages[0].content.startsWith("You read requests to restock")) {
        if (opts.shopperModel instanceof Error) return new Response(opts.shopperModel.message, { status: 500 });
        const m = opts.shopperModel;
        const content = (typeof m === "function" ? m(body.messages[1].content) : m) ?? "no idea";
        return Response.json({ choices: [{ message: { role: "assistant", content } }] });
      }
      const reply: CortexReply = core.shift() ?? { content: "fallback final" };
      if (reply instanceof Error) return new Response(reply.message, { status: 500 });
      return Response.json({ choices: [{ message: { role: "assistant", ...reply } }] });
    }
    if (url === "https://api.jina.ai/v1/embeddings") {
      if (opts.jinaEmbedFail) return new Response("down", { status: 503 });
      return Response.json({ data: [{ embedding: fakeEmbedding(body.input[0]) }] });
    }
    const site = (init?.headers as Record<string, string> | undefined)?.["X-Site"];
    if (url.startsWith("https://s.jina.ai/") && site && /amazon|walmart/.test(site)) {
      if (opts.shopSearch instanceof Error) return new Response("down", { status: 503 });
      const q = new URL(url).searchParams.get("q")!;
      return Response.json({ data: opts.shopSearch ? opts.shopSearch(site, q) : [storeListing(site, q)] });
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
    if (url === "https://api.cartesia.ai/tts/bytes") {
      if (opts.cartesiaTtsFail) return new Response("overloaded", { status: 500 });
      return new Response(FAKE_MP3, { headers: { "Content-Type": "audio/mpeg" } });
    }
    if (url === CREAO_REPORT_URL) return new Response("# Symptom & Biosensor Health Analysis\n\nFull report.");
    if (url.startsWith("https://agent.creao.ai/api/v1/apps/")) {
      if (init?.method === "POST") {
        if (opts.creaoStartFail) return new Response("insufficient credits", { status: 402 });
        return Response.json({ id: "run_1", status: "pending", appId: "app", appName: "Symptom & Biosensor Health Analyzer" });
      }
      const next = creaoRuns.length > 1 ? creaoRuns.shift()! : creaoRuns[0];
      return Response.json({ id: url.split("/runs/")[1], ...next });
    }
    if (url === "https://api.typesafe.ai/v1/systemone") {
      if (opts.jev instanceof Error) return new Response(opts.jev.message, { status: 500 });
      const given = typeof opts.jev === "function" ? opts.jev(body) : (opts.jev ?? {});
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((k) => [k, { type: "noul", noul: given[k as keyof JevAnswers] ?? 0.05 }]),
      );
      return Response.json({ model: "jev-1.14.0", answers });
    }
    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      if (opts.aqi === null) return Response.json({});
      return Response.json({ results: [{ name: "San Francisco", admin1: "California", latitude: 37.77, longitude: -122.42 }] });
    }
    if (url.startsWith("https://air-quality-api.open-meteo.com/")) {
      return Response.json({ current: { us_aqi: opts.aqi ?? 42, pm2_5: 8 } });
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
  vi.stubEnv("JEV_API_KEY", "apikey_test");
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
export const storeSearches = (calls: Call[]) =>
  calls.filter((c) => c.url.startsWith("https://s.jina.ai/") && /amazon|walmart/.test((c.init?.headers as Record<string, string>)?.["X-Site"] ?? ""));
export const jevCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("api.typesafe.ai"));
// Snowflake calls that read a shopping request (their system prompt lists the kits).
export const shopperModelCalls = (calls: Call[]) =>
  cortexCalls(calls).filter((c) => c.body.messages[0].content.startsWith("You read requests to restock"));
export const telegramTyping = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/sendChatAction"));

export async function drain(t: ReturnType<typeof setup>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

export function messagesOf(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.run((ctx) =>
    ctx.db.query("messages").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
  );
}
