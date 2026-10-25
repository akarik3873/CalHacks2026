import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { audioFileName } from "../convex/lib/telegram";
import { DAILY_LIMIT } from "../convex/pipeline";
import {
  Call,
  cortexCalls,
  createAppUser,
  drain,
  FAKE_MP3,
  messagesOf,
  mockApis,
  setEnv,
  setup,
  telegramSends,
  telegramTyping,
  telegramVoices,
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

const CHAT = 555;

function post(t: ReturnType<typeof setup>, message: object) {
  return t.fetch("/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
    body: JSON.stringify({ message: { chat: { id: CHAT, type: "private" }, from: { first_name: "Sam" }, ...message } }),
  });
}

const voiceNote = (duration = 4, fileId = "voice_1") =>
  ({ voice: { file_id: fileId, file_unique_id: "u1", duration, mime_type: "audio/ogg" } });

const sttCalls = (calls: Call[]) => calls.filter((c) => c.url === "https://api.cartesia.ai/stt");
const ttsCalls = (calls: Call[]) => calls.filter((c) => c.url === "https://api.cartesia.ai/tts/bytes");
const downloads = (calls: Call[]) => calls.filter((c) => c.url.startsWith("https://api.telegram.org/file/"));
const userOf = async (t: ReturnType<typeof setup>) =>
  (await t.run((ctx) => ctx.db.query("users").collect())).find((u) => u.telegramChatId === String(CHAT))!;

describe("telegram voice notes", () => {
  test("transcribed by Cartesia, answered in text (quoting what was heard) and as a voice note", async () => {
    const t = setup();
    const { calls } = mockApis({
      cartesiaStt: "I have a mild headache, what should I do?",
      core: [{ content: "**Rest** in a dark room and drink water. See [CDC](https://cdc.gov)." }],
    });
    expect((await post(t, voiceNote())).status).toBe(200);
    await drain(t);

    // Download: getFile, then the file itself.
    expect(calls.find((c) => c.url.endsWith("/getFile"))!.body).toEqual({ file_id: "voice_1" });
    expect(downloads(calls)[0].url).toBe("https://api.telegram.org/file/botbot_test/voice/file_7.oga");

    // STT: the server key, ink-whisper, and a file name that tells Cartesia it's Ogg.
    const [stt] = sttCalls(calls);
    expect((stt.init!.headers as any).Authorization).toBe("Bearer cartesia_test");
    const form = stt.body as FormData;
    expect(form.get("model")).toBe("ink-whisper");
    expect((form.get("file") as File).name).toBe("audio.oga");

    // The transcript goes through the normal pipeline as a voice message.
    const user = await userOf(t);
    const [question] = await messagesOf(t, user._id);
    expect(question).toMatchObject({ role: "user", text: "I have a mild headache, what should I do?", voice: true, channel: "telegram" });
    expect(cortexCalls(calls).at(-1)!.body.messages.at(-1).content).toBe("I have a mild headache, what should I do?");

    // Text first (with what we heard), then the spoken reply.
    const sends = telegramSends(calls);
    expect(sends).toHaveLength(1);
    expect(sends[0].body.text).toMatch(/^🎙️ <i>“I have a mild headache, what should I do\?”<\/i>\n\n<b>Rest<\/b> in a dark room/);
    expect(ttsCalls(calls)[0].body.transcript).toBe("Rest in a dark room and drink water. See CDC.");
    const [voice] = telegramVoices(calls);
    const vf = voice.body as FormData;
    expect(vf.get("chat_id")).toBe(String(CHAT));
    expect(vf.get("duration")).toBe("1");
    const file = vf.get("voice") as File;
    expect(file.name).toBe("reply.mp3");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(FAKE_MP3);
    expect(calls.indexOf(sends[0])).toBeLessThan(calls.indexOf(voice));
    expect(telegramTyping(calls).map((c) => c.body.action)).toEqual(
      expect.arrayContaining(["typing", "record_voice", "upload_voice"]),
    );
  });

  test("text messages still get text only", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { text: "hello" });
    await drain(t);
    expect(telegramSends(calls)[0].body.text).toBe("Rest and drink water.");
    expect(telegramVoices(calls)).toHaveLength(0);
    expect(ttsCalls(calls)).toHaveLength(0);
  });

  test("the app shows the transcript, labeled as a Telegram voice note", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    await t.run((ctx) => ctx.db.patch(userId, { telegramChatId: String(CHAT) })); // a linked chat
    await post(t, voiceNote());
    await drain(t);
    const list = await as.query(api.chat.list);
    expect(list.find((m: any) => m.role === "user")).toMatchObject({ text: "I have a headache", voice: true });
  });

  test("store links go in the text; only the reply is spoken", async () => {
    const t = setup();
    const { calls } = mockApis({
      cartesiaStt: "I just got my period and the cramps are bad",
      jev: { needs_supplies: 0.93 },
      core: [{ content: "Sorry about the cramps. Heat helps." }],
    });
    await post(t, voiceNote());
    await drain(t);
    expect(telegramSends(calls)[0].body.text).toContain("Period care");
    expect(ttsCalls(calls)).toHaveLength(1);
    expect(ttsCalls(calls)[0].body.transcript).toBe("Sorry about the cramps. Heat helps.");
  });

  test("over 3 minutes: politely refused before downloading anything", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, voiceNote(181));
    await drain(t);
    expect(downloads(calls)).toHaveLength(0);
    expect(sttCalls(calls)).toHaveLength(0);
    expect(telegramSends(calls)[0].body.text).toMatch(/over 3 minutes/);
  });

  test("over the daily limit: no download, no STT, the limit notice", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { text: "first" });
    await drain(t);
    const user = await userOf(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < DAILY_LIMIT; i++) {
        await ctx.db.insert("messages", { userId: user._id, role: "user", text: `m${i}`, channel: "telegram" });
      }
    });
    await post(t, voiceNote());
    await drain(t);
    expect(downloads(calls)).toHaveLength(0);
    expect(sttCalls(calls)).toHaveLength(0);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/limit of 100 messages/);
  });

  test("silence: asks to try again; nothing reaches the model", async () => {
    const t = setup();
    const { calls } = mockApis({ cartesiaStt: "   " });
    await post(t, voiceNote());
    await drain(t);
    expect(cortexCalls(calls)).toHaveLength(0);
    expect(telegramSends(calls)[0].body.text).toMatch(/couldn't make out any words/);
    expect(await messagesOf(t, (await userOf(t))._id)).toHaveLength(0);
  });

  test("STT down or file unavailable: a friendly reply, nothing stored", async () => {
    for (const opts of [{ cartesiaStt: new Error("overloaded") }, { telegramFileGone: true }]) {
      const t = setup();
      const { calls } = mockApis(opts);
      await post(t, voiceNote());
      await drain(t);
      expect(cortexCalls(calls)).toHaveLength(0);
      const text = telegramSends(calls)[0].body.text;
      expect(text).toMatch(/couldn't listen to that voice note/);
      expect(text).not.toMatch(/overloaded|too big/);
      expect(await messagesOf(t, (await userOf(t))._id)).toHaveLength(0);
    }
  });

  test("TTS down: the text reply still arrives, just without the voice note", async () => {
    const t = setup();
    const { calls } = mockApis({ cartesiaTtsFail: true });
    await post(t, voiceNote());
    await drain(t);
    expect(telegramSends(calls)).toHaveLength(1);
    expect(telegramSends(calls)[0].body.text).toContain("Rest and drink water.");
    expect(telegramVoices(calls)).toHaveLength(0);
  });

  test("audio files sent to the bot are transcribed too", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { audio: { file_id: "aud_1", file_unique_id: "u2", duration: 20, mime_type: "audio/mpeg" } });
    await drain(t);
    expect(calls.find((c) => c.url.endsWith("/getFile"))!.body).toEqual({ file_id: "aud_1" });
    expect(telegramVoices(calls)).toHaveLength(1);
  });
});

describe("audioFileName", () => {
  test("uses the file's extension when Cartesia knows it, else the MIME type", () => {
    expect(audioFileName("voice/file_7.oga")).toBe("audio.oga");
    expect(audioFileName("music/file_8.MP3")).toBe("audio.mp3");
    expect(audioFileName("documents/file_9", "audio/x-m4a")).toBe("audio.m4a");
    expect(audioFileName("documents/file_9.bin", "audio/wav; codecs=1")).toBe("audio.wav");
    expect(audioFileName("documents/file_9")).toBe("audio.ogg");
  });
});
