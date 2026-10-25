// Jev routing: proactive shopping (store links), the symptom analyzer only after the user's OK, and the regular path.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  cortexCalls,
  createAppUser,
  creaoStarts,
  drain,
  jevCalls,
  messagesOf,
  mockApis,
  setEnv,
  setup,
  shopperModelCalls,
  telegramSends,
} from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
  vi.stubEnv("CREAO_API_KEY", "capi_test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const coreCalls = (calls: any[]) => cortexCalls(calls).filter((c) => c.body.model !== "claude-haiku-4-5");
const systemOf = (call: any) => call.body.messages[0].content as string;
const toolNames = (call: any) => call.body.tools.map((x: any) => x.function.name) as string[];
const userOf = (t: ReturnType<typeof setup>, userId: Id<"users">) => t.run((ctx) => ctx.db.get(userId));
const assistantTexts = async (t: ReturnType<typeof setup>, userId: Id<"users">) =>
  (await messagesOf(t, userId)).filter((m) => m.role === "assistant").map((m) => m.text);

describe("regular messages", () => {
  test("nothing routed -> no shopper, no analyzer tool, no offer", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "How much water should I drink a day?" });
    await drain(t);
    expect(jevCalls(calls)).toHaveLength(1);
    expect(Object.keys(jevCalls(calls)[0].body.questions)).toEqual(["urgent", "needs_supplies", "wants_analysis", "consent"]);
    expect(jevCalls(calls)[0].body.state).toContain("User's message: How much water");
    expect(shopperModelCalls(calls)).toHaveLength(0);
    expect(toolNames(coreCalls(calls)[0])).not.toContain("analyze_symptoms");
    expect(systemOf(coreCalls(calls)[0])).not.toContain("CREAO");
    expect(await assistantTexts(t, userId)).toEqual(["Rest and drink water."]);
  });

  test("Jev down -> the regular assistant still answers", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: new Error("down") });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I just got my period" });
    await drain(t);
    expect(shopperModelCalls(calls)).toHaveLength(0);
    expect(await assistantTexts(t, userId)).toEqual(["Rest and drink water."]);
  });
});

describe("proactive shopping", () => {
  test("period -> store links shown after the reply; nothing waits for approval", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { needs_supplies: 0.93 }, core: [{ content: "Sorry about the cramps. Heat helps." }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I just got my period and the cramps are bad" });
    await drain(t);
    expect(shopperModelCalls(calls)).toHaveLength(1);
    expect(shopperModelCalls(calls)[0].body.messages[1].content).toBe("I just got my period and the cramps are bad");
    expect(systemOf(coreCalls(calls)[0])).toContain("the app shows the user Amazon and Walmart links");
    const texts = await assistantTexts(t, userId);
    expect(texts[0]).toBe("Sorry about the cramps. Heat helps.");
    expect(texts[1]).toMatch(/^\*\*Period care\*\*: your approved items/);
    expect(texts[1]).toContain("](https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=");
    expect(await t.run((ctx) => ctx.db.query("carts").collect())).toHaveLength(0);
  });

  test("a yes after the links is a regular message: no shopper, no order questions for Jev", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: (body) => (body.state.includes("User's message: yes") ? {} : { needs_supplies: 0.9 }) });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I have a pounding headache" });
    await drain(t);
    await as.mutation(api.chat.send, { text: "yes" });
    await drain(t);
    expect(Object.keys(jevCalls(calls).at(-1)!.body.questions)).toEqual(["urgent", "needs_supplies", "wants_analysis", "consent"]);
    expect(shopperModelCalls(calls)).toHaveLength(1);
    expect(systemOf(coreCalls(calls).at(-1)!)).not.toContain("Amazon and Walmart links");
  });

  test("the shopper can't build a kit -> no extra message", async () => {
    const t = setup();
    mockApis({ jev: { needs_supplies: 0.6 } });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I feel a bit sore" });
    await drain(t);
    expect(await assistantTexts(t, userId)).toEqual(["Rest and drink water."]);
  });

  test("emergencies never go shopping", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { needs_supplies: 0.9, urgent: 0.95 } });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "crushing chest pain and my arm is numb" });
    await drain(t);
    expect(shopperModelCalls(calls)).toHaveLength(0);
  });

  test("Telegram gets the reply and the links in one message", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { needs_supplies: 0.9 }, core: [{ content: "Heat helps." }] });
    await t.mutation(internal.telegram.handleIncoming, { chatId: "777", text: "cramps are starting" });
    await drain(t);
    const sends = telegramSends(calls);
    expect(sends).toHaveLength(1);
    expect(sends[0].body.text).toContain("Heat helps.");
    expect(sends[0].body.text).toContain("Period care");
  });
});

describe("symptom analyzer consent", () => {
  const analyzeCall = { content: null, tool_calls: [{ id: "a1", type: "function", function: { name: "analyze_symptoms", arguments: '{"symptoms":"tired, short of breath"}' } }] };

  test("wants analysis, no OK yet -> the model offers it; the tool isn't available", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { wants_analysis: 0.95 } });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "Tired and short of breath for 3 weeks, what could it be?" });
    await drain(t);
    const core = coreCalls(calls)[0];
    expect(systemOf(core)).toContain("offer a detailed symptom analysis");
    expect(toolNames(core)).not.toContain("analyze_symptoms");
    expect((await userOf(t, userId))?.analysisOfferedAt).toBeTypeOf("number");
    expect(creaoStarts(calls)).toHaveLength(0);
  });

  test("yes to the offer -> the tool is available and the run starts; the offer is cleared", async () => {
    const t = setup();
    const { calls } = mockApis({
      jev: (body) => (body.state.includes("User's message: yes") ? { consent: 0.99 } : { wants_analysis: 0.95 }),
      core: [{ content: "Want a detailed analysis? Reply yes." }, analyzeCall, { content: "Started. The report arrives in a few minutes." }],
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "Tired and short of breath for 3 weeks, what could it be?" });
    await drain(t);
    await as.mutation(api.chat.send, { text: "yes please" });
    await drain(t);
    expect(jevCalls(calls)[1].body.state).toContain("offered a detailed symptom analysis");
    const core = coreCalls(calls)[1];
    expect(toolNames(core)).toContain("analyze_symptoms");
    expect(systemOf(core)).toContain("The user agreed to a detailed symptom analysis");
    expect(creaoStarts(calls)).toHaveLength(1);
    expect((await userOf(t, userId))?.analysisOfferedAt).toBeUndefined();
  });

  test("asking for the analysis outright counts as the OK", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { wants_analysis: 0.9, consent: 0.9 }, core: [analyzeCall, { content: "Started." }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "Please run a detailed analysis of my symptoms: tired, short of breath" });
    await drain(t);
    expect(creaoStarts(calls)).toHaveLength(1);
  });

  test("a 'yes' with no offer and nothing to analyze doesn't unlock the tool", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { consent: 0.9 } });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "yes" });
    await drain(t);
    expect(toolNames(coreCalls(calls)[0])).not.toContain("analyze_symptoms");
  });

  test("the model calling analyze_symptoms without the OK gets a tool error; nothing is sent to CREAO", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { wants_analysis: 0.9 }, core: [analyzeCall, { content: "Want me to run it?" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "what could cause tiredness and breathlessness?" });
    await drain(t);
    const tool = coreCalls(calls)[1].body.messages.find((m: any) => m.role === "tool");
    expect(tool.content).toMatch(/hasn't agreed/);
    expect(creaoStarts(calls)).toHaveLength(0);
  });

  test("the offer expires after 30 minutes", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: (body) => (body.state.includes("User's message: yes") ? { consent: 0.99 } : { wants_analysis: 0.95 }) });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "Tired and short of breath for 3 weeks, what could it be?" });
    await drain(t);
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await as.mutation(api.chat.send, { text: "yes" });
    await drain(t);
    expect(toolNames(coreCalls(calls)[1])).not.toContain("analyze_symptoms");
  });
});
