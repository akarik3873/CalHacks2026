import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { createAppUser, FAKE_MP3, messagesOf, mockApis, setEnv, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ttsCalls = (calls: { url: string }[]) => calls.filter((c) => c.url === "https://api.cartesia.ai/tts/bytes");

async function reply(t: ReturnType<typeof setup>, userId: any, text: string, role: "user" | "assistant" = "assistant") {
  return t.run((ctx) => ctx.db.insert("messages", { userId, role, text, channel: "app" }));
}

describe("/tts (native voice mode)", () => {
  test("streams a spoken version of the caller's own reply", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    const id = await reply(t, userId, "## Tips\n- **Rest** and see [CDC](https://cdc.gov)");
    const res = await as.fetch(`/tts?message=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FAKE_MP3);
    const [call] = ttsCalls(calls);
    expect((call as any).init.headers.Authorization).toBe("Bearer cartesia_test");
    expect((call as any).init.headers["Cartesia-Version"]).toBe("2026-08-14");
    expect((call as any).body).toMatchObject({
      model_id: "sonic-3.6",
      transcript: "Tips. Rest and see CDC.",
      voice: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    });
  });

  test("CARTESIA_VOICE_ID picks the voice", async () => {
    vi.stubEnv("CARTESIA_VOICE_ID", "voice_custom");
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.fetch(`/tts?message=${await reply(t, userId, "Hello.")}`);
    expect((ttsCalls(calls)[0] as any).body.voice).toBe("voice_custom");
  });

  test("needs sign-in, and only speaks the caller's own assistant replies", async () => {
    const t = setup();
    const { calls } = mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    const aReply = await reply(t, a.userId, "A's private reply.");
    const aQuestion = await reply(t, a.userId, "A's question", "user");
    expect((await t.fetch(`/tts?message=${aReply}`)).status).toBe(401);
    expect((await b.as.fetch(`/tts?message=${aReply}`)).status).toBe(404);
    expect((await a.as.fetch(`/tts?message=${aQuestion}`)).status).toBe(404);
    expect((await a.as.fetch(`/tts?message=not-an-id`)).status).toBe(404);
    expect((await a.as.fetch(`/tts`)).status).toBe(404);
    expect(ttsCalls(calls)).toHaveLength(0);
  });

  test("a reply with nothing speakable isn't sent to Cartesia", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    expect((await as.fetch(`/tts?message=${await reply(t, userId, "https://example.com")}`)).status).toBe(404);
    expect(ttsCalls(calls)).toHaveLength(0);
  });

  test("Cartesia down -> 502 without leaking details", async () => {
    const t = setup();
    mockApis({ cartesiaTtsFail: true });
    const { userId, as } = await createAppUser(t);
    const res = await as.fetch(`/tts?message=${await reply(t, userId, "Hello.")}`);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("overloaded");
  });
});

describe("store links are marked so they're never read aloud", () => {
  test("the reply is spoken; the links message under it is kind=links", async () => {
    const t = setup();
    mockApis();
    const { userId } = await createAppUser(t);
    await t.mutation(internal.pipeline.saveReply, {
      userId,
      text: "Here are links for what I'd get you:",
      extra: "- Acetaminophen: [Amazon](https://amazon.com/x)",
      channel: "app",
      urgent: false,
    });
    const [main, links] = await messagesOf(t, userId);
    expect(main.kind).toBeUndefined();
    expect(links.kind).toBe("links");
  });
});
