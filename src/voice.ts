// Cartesia STT called directly from the app with a short-lived token from Convex.
// Replies are spoken by ./speaker (WebSocket streaming on web, a streamed MP3 on native).
import { Platform } from "react-native";

export type CartesiaToken = { token: string; version: string; voiceId: string };

export async function transcribe(t: CartesiaToken, uri: string): Promise<string> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    // Chrome and Firefox record WebM; Safari records MP4. The name tells Cartesia which container it is.
    form.append("file", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
  } else {
    form.append("file", { uri, name: "audio.m4a", type: "audio/m4a" } as any);
  }
  form.append("model", "ink-whisper");
  form.append("language", "en");
  const res = await fetch("https://api.cartesia.ai/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Cartesia-Version": t.version },
    body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  return (await res.json()).text ?? "";
}
