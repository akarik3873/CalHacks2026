// Short-lived Cartesia tokens so the API key never ships in the app.
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { env } from "./lib/env";

export const CARTESIA_VERSION = "2026-08-14";

export const token = action({
  args: {},
  handler: async (ctx) => {
    if (!(await getAuthUserId(ctx))) throw new Error("Not signed in");
    const res = await fetch("https://api.cartesia.ai/access-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("CARTESIA_API_KEY")}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 300 }),
    });
    if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);
    const { token } = await res.json();
    return {
      token: token as string,
      version: CARTESIA_VERSION,
      voiceId: process.env.CARTESIA_VOICE_ID ?? "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
    };
  },
});
