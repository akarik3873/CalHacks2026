import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { internal } from "../convex/_generated/api";
import { chunkText, markdownToTelegramHtml } from "../convex/lib/telegram";
import { Call, cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup, telegramSends, telegramTyping } from "./helpers";
import { DAILY_LIMIT } from "../convex/pipeline";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function update(text: string, chatId = 555, type = "private") {
  return { message: { text, chat: { id: chatId, type }, from: { first_name: "Sam", last_name: "Lee" } } };
}

async function post(t: ReturnType<typeof setup>, body: any, secret: string | null = "s3cret") {
  return t.fetch("/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) },
    body: JSON.stringify(body),
  });
}

const newCode = async (as: any) => (await as.mutation(api.telegram.createLinkUrl)).split("start=")[1] as string;
const linkPrompts = (calls: Call[]) => telegramSends(calls).filter((c) => c.body.reply_markup);

async function press(t: ReturnType<typeof setup>, data: string, chatId: number) {
  return post(t, {
    callback_query: { id: "cb1", data, from: { id: chatId }, message: { message_id: 77, chat: { id: chatId, type: "private" } } },
  });
}

// /start <code> in a chat, then press Yes or No on the prompt.
async function linkVia(t: ReturnType<typeof setup>, calls: Call[], code: string, chatId: number, answer: "yes" | "no") {
  await post(t, update(`/start ${code}`, chatId));
  await drain(t);
  const buttons = linkPrompts(calls).at(-1)!.body.reply_markup.inline_keyboard[0];
  await press(t, buttons[answer === "yes" ? 0 : 1].callback_data, chatId);
  await drain(t);
}

const telegramUsers = (t: ReturnType<typeof setup>) =>
  t.run((ctx) => ctx.db.query("users").collect());

describe("webhook auth", () => {
  test("missing or wrong secret -> 403, nothing stored", async () => {
    const t = setup();
    mockApis();
    expect((await post(t, update("hi"), null)).status).toBe(403);
    expect((await post(t, update("hi"), "wrong")).status).toBe(403);
    expect(await telegramUsers(t)).toHaveLength(0);
  });

  test("secret not configured -> 403 (fails closed)", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const t = setup();
    mockApis();
    expect((await post(t, update("hi"))).status).toBe(403);
  });

  test("group chats, edits and non-text updates are ignored with 200", async () => {
    const t = setup();
    mockApis();
    expect((await post(t, update("hi", 1, "group"))).status).toBe(200);
    expect((await post(t, { edited_message: { text: "x", chat: { id: 1, type: "private" } } })).status).toBe(200);
    expect((await post(t, { message: { photo: [], chat: { id: 1, type: "private" } } })).status).toBe(200);
    expect(await telegramUsers(t)).toHaveLength(0);
  });
});

describe("telegram-only users", () => {
  test("first message auto-creates account and reply goes back to the same chat", async () => {
    const t = setup();
    const { calls } = mockApis();
    expect((await post(t, update("I have a cough"))).status).toBe(200);
    await drain(t);
    const users = await telegramUsers(t);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: "Sam Lee", telegramChatId: "555" });
    const msgs = await messagesOf(t, users[0]._id);
    expect(msgs.map((m) => [m.role, m.channel])).toEqual([["user", "telegram"], ["assistant", "telegram"]]);
    const sends = telegramSends(calls);
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toBe("https://api.telegram.org/botbot_test/sendMessage");
    expect(sends[0].body).toMatchObject({ chat_id: "555", text: "Rest and drink water.", parse_mode: "HTML" });
  });

  test("second message reuses the same account", async () => {
    const t = setup();
    mockApis();
    await post(t, update("one"));
    await post(t, update("two"));
    await drain(t);
    expect(await telegramUsers(t)).toHaveLength(1);
  });

  test("/start without code sends welcome, does not run the model", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, update("/start"));
    await drain(t);
    expect(await telegramUsers(t)).toHaveLength(1);
    expect(telegramSends(calls)[0].body.text).toMatch(/health assistant/);
    expect(calls.some((c) => c.url.includes("snowflake"))).toBe(false);
  });

  test("long replies are split under Telegram's 4096 limit", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "a".repeat(9000) }] });
    await post(t, update("long please"));
    await drain(t);
    const sends = telegramSends(calls);
    expect(sends.map((s) => s.body.text.length)).toEqual([3500, 3500, 2000]);
  });
});

describe("linking app account <-> Telegram", () => {
  test("createLinkUrl requires sign-in and returns a t.me deep link", async () => {
    const t = setup();
    await expect(t.mutation(api.telegram.createLinkUrl)).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    expect(await as.mutation(api.telegram.createLinkUrl)).toMatch(/^https:\/\/t\.me\/HealthBot\?start=[a-f0-9]{32}$/);
  });

  test("/start <code> only asks; nothing is linked until Yes", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t, "jane@gmail.com");
    const code = await newCode(as);
    await post(t, update(`/start ${code}`));
    await drain(t);
    const prompt = linkPrompts(calls).at(-1)!;
    expect(prompt.body.chat_id).toBe("555");
    expect(prompt.body.text).toContain("j***@gmail.com");
    expect(prompt.body.text).not.toContain("jane@gmail.com");
    expect(prompt.body.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(["Yes, link", "No"]);
    expect((await as.query(api.chat.me))!.telegramLinked).toBe(false);
  });

  test("Yes links; prior Telegram-only history is merged; app chat sees it", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, update("old telegram question"));
    await drain(t);
    const { userId, as } = await createAppUser(t);
    await linkVia(t, calls, await newCode(as), 555, "yes");

    const users = await telegramUsers(t);
    expect(users).toHaveLength(1); // telegram-only account folded in and deleted
    expect(users[0]._id).toBe(userId);
    expect((await as.query(api.chat.me))!.telegramLinked).toBe(true);
    expect((await as.query(api.chat.list)).map((m: any) => m.text)).toContain("old telegram question");
    const edits = calls.filter((c) => c.url.endsWith("/editMessageText"));
    expect(edits.at(-1)!.body).toMatchObject({ chat_id: "555", message_id: 77 });
    expect(edits.at(-1)!.body.text).toMatch(/^Linked/);
    expect(calls.some((c) => c.url.endsWith("/answerCallbackQuery"))).toBe(true);

    // Next Telegram message lands on the app account.
    await post(t, update("new msg"));
    await drain(t);
    expect((await messagesOf(t, userId)).some((m) => m.text === "new msg")).toBe(true);
  });

  test("hijack attempt: victim taps attacker's link and says No -> nothing linked or moved", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, update("victim's private symptom"));
    await drain(t);
    const attacker = await createAppUser(t, "evil@example.com");
    await linkVia(t, calls, await newCode(attacker.as), 555, "no");
    expect((await attacker.as.query(api.chat.me))!.telegramLinked).toBe(false);
    expect(await attacker.as.query(api.chat.list)).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith("/editMessageText")).at(-1)!.body.text).toMatch(/not linked/);
    // The code is used up: pressing Yes afterwards does nothing.
    await press(t, linkPrompts(calls).at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data, 555);
    await drain(t);
    expect((await attacker.as.query(api.chat.me))!.telegramLinked).toBe(false);
  });

  test("a different chat can't press Yes on someone else's prompt", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await post(t, update(`/start ${await newCode(as)}`, 1));
    await drain(t);
    const yes = linkPrompts(calls).at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data;
    await press(t, yes, 2);
    await drain(t);
    expect((await as.query(api.chat.me))!.telegramLinked).toBe(false);
    expect(calls.filter((c) => c.url.endsWith("/editMessageText")).at(-1)!.body.text).toMatch(/no longer valid/);
  });

  test("Yes after the code expires does not link", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await post(t, update(`/start ${await newCode(as)}`));
    await drain(t);
    vi.advanceTimersByTime(16 * 60 * 1000);
    await press(t, linkPrompts(calls).at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data, 555);
    await drain(t);
    expect((await as.query(api.chat.me))!.telegramLinked).toBe(false);
  });

  test("garbage callback data is rejected", async () => {
    const t = setup();
    const { calls } = mockApis();
    await press(t, "link:yes:not-an-id", 555);
    await press(t, "something else", 555);
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("/editMessageText")).every((c) => /no longer valid/.test(c.body.text))).toBe(true);
  });

  test("codes are single-use", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    const code = await newCode(as);
    await linkVia(t, calls, code, 1, "yes");
    await post(t, update(`/start ${code}`, 2));
    await drain(t);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/expired/);
    const byChat = await t.run((ctx) => ctx.db.query("users").withIndex("by_telegram", (q) => q.eq("telegramChatId", "2")).unique());
    expect(byChat?.email).toBeUndefined(); // chat 2 got a fresh account, not the app account
  });

  test("expired code does not link and says so", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    const code = await newCode(as);
    vi.advanceTimersByTime(16 * 60 * 1000);
    await post(t, update(`/start ${code}`));
    await drain(t);
    expect((await as.query(api.chat.me))!.telegramLinked).toBe(false);
    expect(linkPrompts(calls)).toHaveLength(0);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/expired/);
  });

  test("relinking a chat from app account A to B never moves A's history", async () => {
    const t = setup();
    const { calls } = mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await linkVia(t, calls, await newCode(a.as), 555, "yes");
    await post(t, update("A private note"));
    await drain(t);
    await linkVia(t, calls, await newCode(b.as), 555, "yes");
    expect((await b.as.query(api.chat.list)).map((m: any) => m.text)).not.toContain("A private note");
    expect((await a.as.query(api.chat.list)).map((m: any) => m.text)).toContain("A private note");
    expect((await a.as.query(api.chat.me))!.telegramLinked).toBe(false);
    expect((await b.as.query(api.chat.me))!.telegramLinked).toBe(true);
  });
});

describe("voice token", () => {
  test("requires sign-in; mints a short-lived Cartesia token server-side", async () => {
    const t = setup();
    const { calls } = mockApis();
    await expect(t.action(api.voice.token)).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    const res = await as.action(api.voice.token);
    expect(res.token).toBe("tok_123");
    const call = calls.find((c) => c.url === "https://api.cartesia.ai/access-token")!;
    expect((call.init!.headers as any).Authorization).toBe("Bearer cartesia_test");
    expect(call.body).toEqual({ grants: { tts: true, stt: true }, expires_in: 300 });
    expect(JSON.stringify(res)).not.toContain("cartesia_test");
  });
});

describe("daily limit on telegram", () => {
  test("11th message gets a limit notice and never reaches the model; app + telegram share the cap", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await linkVia(t, calls, await newCode(as), 555, "yes");
    for (let i = 0; i < DAILY_LIMIT / 2; i++) await as.mutation(api.chat.send, { text: `app ${i}` });
    for (let i = 0; i < DAILY_LIMIT / 2; i++) await post(t, update(`tg ${i}`));
    await drain(t);
    const modelCalls = cortexCalls(calls).length;
    await post(t, update("over the limit"));
    await drain(t);
    expect(cortexCalls(calls).length).toBe(modelCalls);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/limit of 100 messages/);
    expect(await as.mutation(api.chat.send, { text: "app too" })).toMatchObject({ limited: true });
  });
});

describe("telegram formatting + typing", () => {
  test("markdown becomes Telegram HTML, with user text escaped", () => {
    expect(markdownToTelegramHtml("## Tips\n- **Rest** and *hydrate*\n- see [CDC](https://cdc.gov/x?a=1&b=2)\n- use `a<b`\n2 < 3 & 5 > 4")).toBe(
      '<b>Tips</b>\n• <b>Rest</b> and <i>hydrate</i>\n• see <a href="https://cdc.gov/x?a=1&amp;b=2">CDC</a>\n• use <code>a&lt;b</code>\n2 &lt; 3 &amp; 5 &gt; 4',
    );
    expect(markdownToTelegramHtml("2 * 3 * 4 and snake_case_name")).toBe("2 * 3 * 4 and snake_case_name");
  });

  test("chunks split on line boundaries", () => {
    const text = ["a".repeat(2000), "b".repeat(2000), "c".repeat(100)].join("\n");
    expect(chunkText(text).map((c) => c.length)).toEqual([2000, 2101]);
  });

  test("if Telegram rejects the HTML, the reply is resent as plain text", async () => {
    const t = setup();
    const { calls } = mockApis({ telegramRejectHtml: true, core: [{ content: "**hi**" }] });
    await post(t, update("hello"));
    await drain(t);
    const sends = telegramSends(calls);
    expect(sends.map((s) => s.body.parse_mode)).toEqual(["HTML", undefined]);
    expect(sends[1].body.text).toBe("**hi**");
  });

  test("typing indicator is sent on receive and again after each tool round", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "web_search", arguments: '{"query":"x"}' } }] },
        { content: "done" },
      ],
    });
    await post(t, update("question"));
    await drain(t);
    const typing = telegramTyping(calls);
    expect(typing).toHaveLength(2);
    expect(typing[0].body).toEqual({ chat_id: "555", action: "typing" });
  });

  test("app messages never send typing", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "hi" });
    await drain(t);
    expect(telegramTyping(calls)).toHaveLength(0);
  });
});

describe("location", () => {
  test("shared Telegram location pin is saved and used in the next prompt", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { message: { location: { latitude: 37.871234, longitude: -122.27301 }, chat: { id: 555, type: "private" } } });
    await drain(t);
    expect(telegramSends(calls)[0].body.text).toMatch(/saved your location/);
    await post(t, update("where is urgent care"));
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("User's saved location: 37.8712,-122.2730");
  });

  test("model can save a location the user mentions", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "save_location", arguments: '{"location":"Berkeley, CA 94704"}' } }] },
        { content: "Noted." },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I live in Berkeley 94704" });
    await drain(t);
    expect((await as.query(api.chat.me))!.location).toBe("Berkeley, CA 94704");
    const tool = cortexCalls(calls)[1].body.messages.find((m: any) => m.role === "tool");
    expect(tool.content).toBe("Saved location: Berkeley, CA 94704");
    expect(cortexCalls(calls)[0].body.tools.map((x: any) => x.function.name)).toContain("save_location");
  });

  test("settings: set and clear location", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLocation, { location: "  Oakland, CA  " });
    expect((await as.query(api.chat.me))!.location).toBe("Oakland, CA");
    await as.mutation(api.chat.setLocation, { location: " " });
    expect((await as.query(api.chat.me))!.location).toBe("");
    await expect(t.mutation(api.chat.setLocation, { location: "x" })).rejects.toThrow(/Not signed in/);
  });
});

describe("cleanup cron", () => {
  test("deletes only expired link codes", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await as.mutation(api.telegram.createLinkUrl);
    vi.advanceTimersByTime(16 * 60 * 1000);
    await as.mutation(api.telegram.createLinkUrl);
    await t.mutation(internal.telegram.deleteExpiredLinks, {});
    const left = await t.run((ctx) => ctx.db.query("telegramLinks").collect());
    expect(left).toHaveLength(1);
    expect(left[0].expiresAt).toBeGreaterThan(Date.now());
  });
});
