// Cartesia REST calls made with the server's API key: short-lived client tokens, speech-to-text, text-to-speech.
import { env } from "./env";
import { DEFAULT_VOICE_ID, TTS_MODEL } from "./speech";

export const CARTESIA_VERSION = "2026-08-14";
const API = "https://api.cartesia.ai";

const headers = () => ({
  Authorization: `Bearer ${env("CARTESIA_API_KEY")}`,
  "Cartesia-Version": CARTESIA_VERSION,
});

export const voiceId = () => process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID;

// A token the app can use for STT and TTS (REST and WebSocket) for 5 minutes, so the key never ships in the app.
export async function accessToken(): Promise<string> {
  const res = await fetch(`${API}/access-token`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 300 }),
  });
  if (!res.ok) throw new Error(`Cartesia ${res.status}: ${await res.text()}`);
  return (await res.json()).token as string;
}

// Batch STT with ink-whisper. The file name's extension tells Cartesia the container (ogg, webm, m4a, mp3...).
export async function transcribe(audio: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("model", "ink-whisper");
  form.append("language", "en");
  const res = await fetch(`${API}/stt`, { method: "POST", headers: headers(), body: form });
  if (!res.ok) throw new Error(`Cartesia STT ${res.status}: ${await res.text()}`);
  return String((await res.json()).text ?? "").trim();
}

// Sonic TTS as MP3. The response body streams as audio is generated, so it can be piped straight to a player.
export async function synthesizeMp3(transcript: string): Promise<Response> {
  const res = await fetch(`${API}/tts/bytes`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: TTS_MODEL,
      transcript,
      voice: voiceId(),
      language: "en",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Cartesia TTS ${res.status}: ${await res.text()}`);
  return res;
}
