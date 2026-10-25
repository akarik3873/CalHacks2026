import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { DAILY_LIMIT } from "../convex/pipeline";
import {
  cortexCalls,
  createAppUser,
  drain,
  fakeEmbedding,
  messagesOf,
  mockApis,
  setEnv,
  setup,
} from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("app chat", () => {
  test("send requires sign-in", async () => {
    const t = setup();
    mockApis();
    await expect(t.mutation(api.chat.send, { text: "hi" })).rejects.toThrow(/Not signed in/);
    expect(await t.query(api.chat.list)).toEqual([]);
    expect(await t.query(api.chat.me)).toBeNull();
  });

  test("blank messages are ignored", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "   " });
    await drain(t);
    expect(await messagesOf(t, userId)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("message -> Jev -> embed -> core -> reply, embeddings stored, list hides vectors", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "  I have a headache  " });
    await drain(t);

    const msgs = await messagesOf(t, userId);
    expect(msgs.map((m) => [m.role, m.text, m.channel])).toEqual([
      ["user", "I have a headache", "app"],
      ["assistant", "Rest and drink water.", "app"],
    ]);
    expect(msgs.every((m) => m.embedding?.length === 1024)).toBe(true);

    const listed = await as.query(api.chat.list);
    expect(listed).toHaveLength(2);
    expect(listed.some((m: any) => "embedding" in m)).toBe(false);

    const cx = cortexCalls(calls);
    expect(cx[0].url).toBe("https://acme.snowflakecomputing.com/api/v2/cortex/v1/chat/completions");
    expect((cx[0].init!.headers as any).Authorization).toBe("Bearer pat_test");
    expect(cx.map((c) => c.body.model)).toEqual(["openai-gpt-5.4"]);
    expect(cx[0].body.tools.map((x: any) => x.function.name)).toEqual([
      "web_search",
      "read_page",
      "bio_research",
      "save_location",
    ]);
    expect(cx.every((c) => c.body.max_tokens === undefined && c.body.stream === false)).toBe(true);
  });

  test("model ids are configurable via env", async () => {
    vi.stubEnv("CORTEX_CORE_MODEL", "openai-gpt-6.1-sol");
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "hi" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.model).toBe("openai-gpt-6.1-sol");
  });

  test("users only see their own messages", async () => {
    const t = setup();
    mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await a.as.mutation(api.chat.send, { text: "my secret symptom" });
    await drain(t);
    expect(await b.as.query(api.chat.list)).toEqual([]);
    expect(await a.as.query(api.chat.list)).toHaveLength(2);
  });

  test("settings: voice mode toggles", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    expect(await as.query(api.chat.me)).toEqual({
      email: "a@example.com",
      voiceMode: false,
      location: "",
      telegramLinked: false,
    });
    await as.mutation(api.chat.setVoiceMode, { enabled: true });
    expect((await as.query(api.chat.me))!.voiceMode).toBe(true);
  });
});

describe("memory (vector search)", () => {
  test("related past messages from the same user go into the prompt; other users' do not", async () => {
    const t = setup();
    const { calls } = mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    // Old, embedded messages, pushed out of the recent window by 12 newer fillers.
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        userId: a.userId, role: "user", channel: "app",
        text: "I am allergic to penicillin", embedding: fakeEmbedding("I am allergic to penicillin"),
      });
      await ctx.db.insert("messages", {
        userId: b.userId, role: "user", channel: "app",
        text: "I am allergic to peanuts and penicillin", embedding: fakeEmbedding("I am allergic to peanuts and penicillin"),
      });
    });
    vi.advanceTimersByTime(60_000);
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        await ctx.db.insert("messages", { userId: a.userId, role: "assistant", channel: "app", text: `filler ${i}`, embedding: fakeEmbedding(`filler ${i}`) });
      }
    });
    await a.as.mutation(api.chat.send, { text: "Am I allergic to penicillin antibiotics?" });
    await drain(t);
    const all = JSON.stringify(cortexCalls(calls)[0].body.messages);
    const system = cortexCalls(calls)[0].body.messages[0].content as string;
    expect(system).toContain("Relevant past messages:\n- [user] I am allergic to penicillin");
    expect(all).not.toContain("peanuts");
  });

  test("Jina down: still answers, no embedding stored", async () => {
    const t = setup();
    mockApis({ jinaEmbedFail: true });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "hello" });
    await drain(t).catch(() => {}); // embedReply throws; scheduled job failure is expected
    const msgs = await messagesOf(t, userId);
    expect(msgs[1].text).toBe("Rest and drink water.");
    expect(msgs[0].embedding).toBeUndefined();
  });
});

describe("triage (Jev)", () => {
  test("urgent -> warning prompt + urgent flag on reply", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { urgent: 0.97 } });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "crushing chest pain" });
    await drain(t);
    const system = cortexCalls(calls)[0].body.messages[0].content as string;
    expect(system).toContain("URGENT");
    expect(system).toContain("911");
    const reply = (await messagesOf(t, userId))[1];
    expect(reply.urgent).toBe(true);
  });

  test("low score or failing Jev falls back to non-urgent and still answers", async () => {
    for (const jev of [{ urgent: 0.2 }, new Error("boom")]) {
      const t = setup();
      mockApis({ jev });
      const { userId, as } = await createAppUser(t);
      await as.mutation(api.chat.send, { text: "hi" });
      await drain(t);
      const reply = (await messagesOf(t, userId))[1];
      expect(reply.urgent).toBe(false);
      expect(reply.text).toBe("Rest and drink water.");
    }
  });
});

describe("tools", () => {
  test("web_search tool call runs Jina and feeds result back", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"urgent care 94704"}' } }] },
        { content: "Go to Urgent care near 94704." },
      ],
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "where is urgent care near 94704" });
    await drain(t);
    expect(calls.some((c) => c.url === "https://s.jina.ai/?q=urgent%20care%2094704")).toBe(true);
    const second = cortexCalls(calls)[1].body.messages;
    const toolMsg = second.find((m: any) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("c1");
    expect(toolMsg.content).toContain("Urgent care near 94704");
    expect((await messagesOf(t, userId))[1].text).toBe("Go to Urgent care near 94704.");
  });

  test("bio_research searches PubMed and reads pages", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "bio_research", arguments: '{"question":"magnesium migraine"}' } }] },
        { content: "Studies suggest..." },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "does magnesium help migraine" });
    await drain(t);
    const search = calls.find((c) => c.url.startsWith("https://s.jina.ai/"))!;
    expect((search.init!.headers as any)["X-Site"]).toBe("pubmed.ncbi.nlm.nih.gov");
    expect(calls.some((c) => c.url.startsWith("https://r.jina.ai/"))).toBe(true);
  });

  test("bad tool args and unknown tools return errors to the model instead of crashing", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [
          { id: "a", type: "function", function: { name: "web_search", arguments: "{not json" } },
          { id: "b", type: "function", function: { name: "nope", arguments: "{}" } },
        ] },
        { content: "ok" },
      ],
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "x" });
    await drain(t);
    const tools = cortexCalls(calls)[1].body.messages.filter((m: any) => m.role === "tool");
    expect(tools[0].content).toMatch(/Tool error/);
    expect(tools[1].content).toMatch(/Unknown tool/);
    expect((await messagesOf(t, userId))[1].text).toBe("ok");
  });

  test("tool loop is capped, then a final no-tools answer is requested", async () => {
    const loop = { content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read_page", arguments: '{"url":"https://a.com"}' } }] };
    const t = setup();
    const { calls } = mockApis({ core: [loop, loop, loop, loop, loop, { content: "final" }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "x" });
    await drain(t);
    const core = cortexCalls(calls);
    expect(core).toHaveLength(6);
    expect(core[5].body.tools).toBeUndefined();
    expect((await messagesOf(t, userId))[1].text).toBe("final");
  });

  test("Cortex down -> friendly fallback reply (no hang)", async () => {
    const t = setup();
    mockApis({ core: [new Error("503")] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "x" });
    await drain(t);
    expect((await messagesOf(t, userId))[1].text).toMatch(/something went wrong/);
  });
});

describe("daily limit", () => {
  test("DAILY_LIMIT (100) messages per user per rolling 24h; the next is rejected and not stored", async () => {
    const t = setup();
    const { calls } = mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    for (let i = 0; i < DAILY_LIMIT; i++) {
      expect(await a.as.mutation(api.chat.send, { text: `q${i}` })).toMatchObject({ limited: false });
    }
    await drain(t);
    const before = cortexCalls(calls).length;
    expect(await a.as.mutation(api.chat.send, { text: "one more" })).toEqual({ limited: true, limit: DAILY_LIMIT });
    await drain(t);
    expect(cortexCalls(calls).length).toBe(before);
    expect((await messagesOf(t, a.userId)).some((m) => m.text === "one more")).toBe(false);
    // Assistant replies don't count, and other users are unaffected.
    expect(await b.as.mutation(api.chat.send, { text: "hi" })).toMatchObject({ limited: false });
    // A day later the window has rolled over.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(await a.as.mutation(api.chat.send, { text: "next day" })).toMatchObject({ limited: false });
    await drain(t);
  });
});

describe("memory window", () => {
  test("messages in the recent chat (or newer than it) are never repeated as memory", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    // An old related message, outside the 12-message recent window.
    await t.run((ctx) =>
      ctx.db.insert("messages", {
        userId, role: "user", channel: "app",
        text: "my knee hurts when running", embedding: fakeEmbedding("my knee hurts when running"),
      }),
    );
    vi.advanceTimersByTime(60_000);
    // 12 newer messages that fill the recent window, one of them closely related.
    await t.run(async (ctx) => {
      for (let i = 0; i < 11; i++) {
        await ctx.db.insert("messages", { userId, role: "assistant", channel: "app", text: `filler ${i}`, embedding: fakeEmbedding(`filler ${i}`) });
      }
      await ctx.db.insert("messages", {
        userId, role: "user", channel: "app",
        text: "knee hurts running again", embedding: fakeEmbedding("knee hurts running again"),
      });
    });
    await as.mutation(api.chat.send, { text: "why does my knee hurt when running" });
    await drain(t);
    const [system, ...rest] = cortexCalls(calls)[0].body.messages;
    expect(system.content).toContain("- [user] my knee hurts when running");
    expect(system.content).not.toContain("knee hurts running again");
    expect(rest.some((m: any) => m.content === "knee hurts running again")).toBe(true);
  });

  test("no memory section when everything related is already in recent chat", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I have a sore throat" });
    await drain(t);
    await as.mutation(api.chat.send, { text: "my sore throat is worse" });
    await drain(t);
    expect(cortexCalls(calls)[1].body.messages[0].content).not.toContain("Relevant past messages:\n");
  });
});
