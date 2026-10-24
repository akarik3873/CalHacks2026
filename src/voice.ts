// Cartesia STT/TTS called directly from the app with a short-lived token from Convex.
import { Platform } from "react-native";
import { createAudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";

export type CartesiaToken = { token: string; version: string; voiceId: string };

const headers = (t: CartesiaToken) => ({
  Authorization: `Bearer ${t.token}`,
  "Cartesia-Version": t.version,
});

export async function transcribe(t: CartesiaToken, uri: string): Promise<string> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, "audio.webm");
  } else {
    form.append("file", { uri, name: "audio.m4a", type: "audio/m4a" } as any);
  }
  form.append("model", "ink-whisper");
  form.append("language", "en");
  const res = await fetch("https://api.cartesia.ai/stt", {
    method: "POST",
    headers: headers(t),
    body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  return (await res.json()).text ?? "";
}

export async function speak(t: CartesiaToken, text: string) {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { ...headers(t), "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: text,
      voice: { id: t.voiceId },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  let uri: string;
  if (Platform.OS === "web") {
    uri = URL.createObjectURL(await res.blob());
  } else {
    const file = new File(Paths.cache, `reply-${Date.now()}.mp3`);
    await file.write(new Uint8Array(await res.arrayBuffer()));
    uri = file.uri;
  }
  const player = createAudioPlayer(uri);
  player.addListener("playbackStatusUpdate", (s) => {
    if (s.didJustFinish) player.remove();
  });
  player.play();
}
