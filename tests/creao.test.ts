import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { DAILY_ANALYSES, MAX_POLLS } from "../convex/creao";
import {
  cortexCalls,
  createAppUser,
  creaoPolls,
  creaoStarts,
  CREAO_REPORT_URL,
  drain,
  messagesOf,
  mockApis,
  setEnv,
  setup,
  telegramSends,
} from "./helpers";

const SITE = "https://happy-otter-123.convex.site";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
  vi.stubEnv("CREAO_API_KEY", "capi_test");
  vi.stubEnv("CREAO_WEBHOOK_SECRET", "hook_secret");
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// The user asked for the analysis, so Jev clears it and the tool is offered.
const AGREED = { wants_analysis: 0.9, consent: 0.95 };

const analyzeCall = (args: object) => ({
  content: null,
  tool_calls: [{ id: "a1", type: "function", function: { name: "analyze_symptoms", arguments: JSON.stringify(args) } }],
});

const toolResult = (calls: any[]) =>
  cortexCalls(calls)
    .flatMap((c) => c.body.messages)
    .find((m: any) => m.role === "tool" && m.tool_call_id === "a1")?.content as string | undefined;

const runsOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("creaoRuns").collect());

function insertRun(t: ReturnType<typeof setup>, userId: Id<"users">, extra: object = {}) {
  return t.run((ctx) =>
    ctx.db.insert("creaoRuns", {
      userId,
      channel: "app",
      inputs: { symptoms: "tired" },
      status: "pending",
      runId: "run_1",
      polls: 0,
      delivered: false,
      ...extra,
    }),
  );
}

function postWebhook(t: ReturnType<typeof setup>, body: unknown, token: string | null = "hook_secret") {
  return t.fetch(`/creao${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("analyze_symptoms tool", () => {
  test("starts a CREAO run with the user's details; the report arrives later as its own message", async () => {
    const t = setup();
    const { calls } = mockApis({
      jev: AGREED,
      core: [
        analyzeCall({ symptoms: "Tired and out of breath on stairs", symptom_duration: "5 weeks, worse", age: 34, sex: "female", bogus: "x" }),
        { content: "I've started a detailed analysis. The report will arrive in a few minutes." },
      ],
      creaoRuns: [{ status: "running" }, { status: "completed", result: { text: "## What the symptoms and data suggest\nIron-deficiency anaemia is more likely." } }],
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "What could be causing this? I'm tired and out of breath on stairs." });
    await drain(t);

    const [start] = creaoStarts(calls);
    expect(creaoStarts(calls)).toHaveLength(1);
    expect(start.url).toBe("https://agent.creao.ai/api/v1/apps/4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c/runs");
    expect((start.init!.headers as any).Authorization).toBe("Bearer capi_test");
    expect(start.body.inputs).toEqual({
      symptoms: "Tired and out of breath on stairs",
      symptom_duration: "5 weeks, worse",
      age: 34,
      sex: "female",
    });
    expect(start.body.webhookUrl).toBe(`${SITE}/creao?token=hook_secret`);
    expect(toolResult(calls)).toContain("Started a detailed symptom analysis");

    const msgs = await messagesOf(t, userId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(msgs[1].text).toContain("I've started a detailed analysis");
    expect(msgs[2].text).toMatch(/^\*\*Your detailed symptom analysis is ready\*\*/);
    expect(msgs[2].text).toContain("Iron-deficiency anaemia is more likely.");
    expect(msgs[2].channel).toBe("app");
    expect(creaoPolls(calls)).toHaveLength(2);

    const [run] = await runsOf(t);
    expect(run).toMatchObject({ status: "completed", delivered: true, runId: "run_1" });
    expect((await as.query(api.chat.list)).at(-1)!.text).toContain("Iron-deficiency");
  });

  test("missing symptoms -> tool error back to the model, nothing sent to CREAO", async () => {
    const t = setup();
    const { calls } = mockApis({
 jev: AGREED,
 core: [
        analyzeCall({ age: 30 }), { content: "Can you describe your symptoms?" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "analyze my symptoms" });
    await drain(t);
    expect(toolResult(calls)).toBe("Tool error: symptoms is required");
    expect(creaoStarts(calls)).toHaveLength(0);
  });

  test("CREAO not set up -> tool error, nothing sent", async () => {
    vi.stubEnv("CREAO_API_KEY", "");
    const t = setup();
    const { calls } = mockApis({
 jev: AGREED,
 core: [
        analyzeCall({ symptoms: "headache" }), { content: "ok" }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "what's causing my headache" });
    await drain(t);
    expect(toolResult(calls)).toContain("isn't set up");
    expect(creaoStarts(calls)).toHaveLength(0);
    expect(await runsOf(t)).toHaveLength(0);
    expect(await messagesOf(t, userId)).toHaveLength(2);
  });

  test(`one analysis at a time, ${DAILY_ANALYSES} a day`, async () => {
    const t = setup();
    mockApis();
    const { userId } = await createAppUser(t);
    const ask = () => t.mutation(internal.creao.request, { userId, channel: "app", inputs: { symptoms: "tired" } });
    const finishAll = () =>
      t.run(async (ctx) => {
        for (const r of await ctx.db.query("creaoRuns").collect()) await ctx.db.patch(r._id, { status: "completed", delivered: true });
      });

    expect(await ask()).toContain("Started");
    expect(await ask()).toContain("already running");
    for (let i = 1; i < DAILY_ANALYSES; i++) {
      await finishAll();
      expect(await ask()).toContain("Started");
    }
    await finishAll();
    expect(await ask()).toContain(`today's ${DAILY_ANALYSES} detailed analyses`);
    expect(await runsOf(t)).toHaveLength(DAILY_ANALYSES);
  });

  test("CREAO rejects the run -> the user is told, nothing polled", async () => {
    const t = setup();
    const { calls } = mockApis({
 jev: AGREED,
 core: [
        analyzeCall({ symptoms: "rash" }), { content: "Started it." }], creaoStartFail: true });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "what is this rash" });
    await drain(t);
    const msgs = await messagesOf(t, userId);
    expect(msgs.at(-1)!.text).toContain("I couldn't finish the detailed symptom analysis");
    expect(creaoPolls(calls)).toHaveLength(0);
    expect((await runsOf(t))[0]).toMatchObject({ status: "failed", errorCode: "start_failed", delivered: true });
  });

  test("local deployment: no webhook (CREAO rejects localhost), polling still delivers", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    const t = setup();
    const { calls } = mockApis({
 jev: AGREED,
 core: [
        analyzeCall({ symptoms: "cough" }), { content: "Started." }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "why do I keep coughing" });
    await drain(t);
    expect("webhookUrl" in creaoStarts(calls)[0].body).toBe(false);
    expect((await messagesOf(t, userId)).at(-1)!.text).toContain("Your detailed symptom analysis is ready");
  });
});

describe("CREAO report", () => {
  // What a finished run really looks like: metrics JSON in text, chat summary, report file, errorCode null.
  const realRun = (artifacts: boolean) => ({
    status: "completed",
    errorCode: null,
    result: {
      text: '{"primary_condition":"Iron-deficiency anaemia","conditions_count":3,"urgency_level":"soon"}',
      chatText: "I'll start by reading the agent's manifest and SKILL.md.Here is the analysis.\n\n**Iron-deficiency anaemia** is more likely.\n\nThe full report is saved to `files/health-analysis-report.md`.",
      artifacts: artifacts ? [{ url: CREAO_REPORT_URL, type: "text/markdown", title: "health-analysis-report.md" }] : [],
    },
  });

  test("delivers the Markdown report file, not the metrics JSON", async () => {
    const t = setup();
    mockApis({ creaoRuns: [realRun(true)] });
    const { userId } = await createAppUser(t);
    await insertRun(t, userId);
    await t.action(internal.creao.poll, { id: (await runsOf(t))[0]._id });
    const last = (await messagesOf(t, userId)).at(-1)!.text;
    expect(last).toContain("# Symptom & Biosensor Health Analysis");
    expect(last).not.toContain("primary_condition");
    expect((await runsOf(t))[0]).toMatchObject({ status: "completed", delivered: true });
  });

  test("no report file -> the chat summary, without the agent's narration", async () => {
    const t = setup();
    mockApis({ creaoRuns: [realRun(false)] });
    const { userId } = await createAppUser(t);
    await insertRun(t, userId);
    await t.action(internal.creao.poll, { id: (await runsOf(t))[0]._id });
    const last = (await messagesOf(t, userId)).at(-1)!.text;
    expect(last).toContain("Here is the analysis.");
    expect(last).toContain("**Iron-deficiency anaemia** is more likely.");
    expect(last).not.toContain("I'll start by");
    expect(last).not.toContain("report is saved to");
    expect(last).not.toContain("primary_condition");
  });

  test("never sends the key to a report URL outside CREAO", async () => {
    const t = setup();
    const run = realRun(true);
    run.result.artifacts[0].url = "https://evil.example.com/report.md";
    const { calls } = mockApis({ creaoRuns: [run] });
    const { userId } = await createAppUser(t);
    await insertRun(t, userId);
    await t.action(internal.creao.poll, { id: (await runsOf(t))[0]._id });
    expect(calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
  });
});

describe("CREAO webhook", () => {
  test("wrong or missing token -> 403; secret not configured -> 403", async () => {
    const t = setup();
    mockApis();
    expect((await postWebhook(t, { runId: "run_1" }, null)).status).toBe(403);
    expect((await postWebhook(t, { runId: "run_1" }, "wrong")).status).toBe(403);
    vi.stubEnv("CREAO_WEBHOOK_SECRET", "");
    expect((await postWebhook(t, { runId: "run_1" }, "")).status).toBe(403);
  });

  test("re-fetches the result from CREAO instead of trusting the body, and delivers once when repeated", async () => {
    const t = setup();
    const { calls } = mockApis({ creaoRuns: [{ status: "completed", result: { text: "Real report from CREAO." } }] });
    const { userId } = await createAppUser(t);
    await insertRun(t, userId);
    const forged = { runId: "run_1", status: "completed", result: { text: "FORGED REPORT" } };

    expect((await postWebhook(t, forged)).status).toBe(200);
    await drain(t);
    expect((await postWebhook(t, forged)).status).toBe(200);
    await drain(t);

    const msgs = await messagesOf(t, userId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("Real report from CREAO.");
    expect(msgs[0].text).not.toContain("FORGED");
    expect(creaoPolls(calls)).toHaveLength(1);
  });

  test("unknown run or junk body -> 200, nothing happens", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId } = await createAppUser(t);
    expect((await postWebhook(t, { runId: "someone_elses_run" })).status).toBe(200);
    expect((await postWebhook(t, "not an object")).status).toBe(200);
    await drain(t);
    expect(creaoPolls(calls)).toHaveLength(0);
    expect(await messagesOf(t, userId)).toHaveLength(0);
  });
});

describe("CREAO polling", () => {
  test("failed run -> failure message with care guidance", async () => {
    const t = setup();
    mockApis({ creaoRuns: [{ status: "failed", errorCode: "AGENT_ERROR" }] });
    const { userId } = await createAppUser(t);
    const id = await insertRun(t, userId);
    await t.action(internal.creao.poll, { id });
    await drain(t);
    const [msg] = await messagesOf(t, userId);
    expect(msg.text).toContain("I couldn't finish the detailed symptom analysis");
    expect(msg.text).toContain("911");
    expect((await runsOf(t))[0]).toMatchObject({ status: "failed", errorCode: "AGENT_ERROR" });
  });

  test("completed with an empty report counts as failed", async () => {
    const t = setup();
    mockApis({ creaoRuns: [{ status: "completed", result: { text: "   " } }] });
    const { userId } = await createAppUser(t);
    const id = await insertRun(t, userId);
    await t.action(internal.creao.poll, { id });
    await drain(t);
    expect((await messagesOf(t, userId))[0].text).toContain("couldn't finish");
    expect((await runsOf(t))[0]).toMatchObject({ status: "failed", errorCode: "empty_report" });
  });

  test(`gives up after ${MAX_POLLS} polls`, async () => {
    const t = setup();
    const { calls } = mockApis({ creaoRuns: [{ status: "running" }] });
    const { userId } = await createAppUser(t);
    const id = await insertRun(t, userId);
    await t.action(internal.creao.poll, { id });
    await drain(t);
    expect(creaoPolls(calls)).toHaveLength(MAX_POLLS);
    const msgs = await messagesOf(t, userId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("it took too long");
    expect((await runsOf(t))[0]).toMatchObject({ status: "failed", errorCode: "timeout", delivered: true });
  });

  test("Telegram user gets the report in Telegram", async () => {
    const t = setup();
    const { calls } = mockApis({ creaoRuns: [{ status: "completed", result: { text: "Telegram report text." } }] });
    const userId = await t.run((ctx) => ctx.db.insert("users", { telegramChatId: "555" }));
    const id = await insertRun(t, userId, { channel: "telegram" });
    await t.action(internal.creao.poll, { id });
    await drain(t);
    const sends = telegramSends(calls);
    expect(sends.some((s) => s.body.chat_id === "555" && String(s.body.text).includes("Telegram report text."))).toBe(true);
  });
});
