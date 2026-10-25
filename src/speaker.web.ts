// Web: stream replies from Cartesia's TTS WebSocket and play each PCM chunk as it arrives (Web Audio),
// so speech starts after the first chunk instead of after the whole file is made.
import { toSpeech, TTS_MODEL } from "../convex/lib/speech";
import type { Speaker, SpeakerDeps, Utterance } from "./speaker";

const WS_URL = "wss://api.cartesia.ai/tts/websocket";
const SAMPLE_RATE = 44100;
const BYTES_PER_SAMPLE = 4; // pcm_f32le: plays as-is in Web Audio, no conversion
const FIRST_CHUNK_LEAD_S = 0.1; // small cushion so early network jitter doesn't cause gaps
const CHUNK_LEAD_S = 0.02;
const STALL_MS = 15_000; // no audio or "done" for this long while generating: give up on the reply

// The reply Cartesia is generating right now. Replies are generated one at a time, but the next one
// starts as soon as the previous one is generated, while its audio is still playing.
type Generation = {
  contextId: string;
  carry: Uint8Array<ArrayBuffer> | null; // trailing bytes of a chunk that didn't make a whole sample
  finish: (error?: Error) => void;
};

export function createSpeaker(deps: SpeakerDeps): Speaker {
  let audio: AudioContext | null = null;
  let socket: WebSocket | null = null;
  let opening: Promise<{ socket: WebSocket; voiceId: string }> | null = null;
  let voiceId = "";
  const queue: Utterance[] = [];
  const sources = new Set<AudioBufferSourceNode>();
  let generation: Generation | null = null;
  let playhead = 0; // AudioContext time when the last scheduled chunk ends
  let running = false;
  let stall: ReturnType<typeof setTimeout> | null = null;
  let onIdle: (() => void) | null = null; // resolves the wait for scheduled audio to finish
  let epoch = 0; // bumped by stop(), so a reply still connecting when stopped never starts

  const context = () => {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    return audio;
  };

  // Browsers keep audio suspended until the page has had a tap; without one, say so instead of playing silence.
  const unlock = async () => {
    const ctx = context();
    if (ctx.state === "running") return;
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    if ((ctx.state as AudioContextState) !== "running") {
      const blocked = new Error("Your browser blocked sound. Tap Mic or Send once to turn on spoken replies.");
      blocked.name = "AudioBlocked";
      throw blocked;
    }
  };

  const connect = async () => {
    const t = await deps.cartesiaToken();
    const url = `${WS_URL}?access_token=${encodeURIComponent(t.token)}&cartesia_version=${encodeURIComponent(t.version)}`;
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Couldn't reach Cartesia"));
      ws.onclose = (e) => reject(new Error(`Cartesia closed the connection (${e.code})`));
    });
    ws.onmessage = (e) => onMessage(ws, e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      generation?.finish(new Error("The voice connection dropped"));
    };
    socket = ws;
    voiceId = t.voiceId;
    return { socket: ws, voiceId };
  };

  // One socket, reused across replies; reopened (with a fresh token) after Cartesia closes it.
  const open = () => {
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve({ socket, voiceId });
    opening ??= connect().finally(() => (opening = null));
    return opening;
  };

  const resetStall = () => {
    if (stall) clearTimeout(stall);
    const g = generation;
    stall = g ? setTimeout(() => g.finish(new Error("Speech timed out")), STALL_MS) : null;
  };

  const schedule = (samples: Float32Array<ArrayBuffer>) => {
    const ctx = context();
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    // Chunks play back to back; after a pause (or at the start) leave a small cushion.
    const at = playhead > ctx.currentTime ? playhead : ctx.currentTime + (sources.size ? CHUNK_LEAD_S : FIRST_CHUNK_LEAD_S);
    src.start(at);
    playhead = at + buffer.duration;
    sources.add(src);
    src.onended = () => {
      sources.delete(src);
      if (!sources.size && !generation) idle();
    };
  };

  const idle = () => {
    const resolve = onIdle;
    onIdle = null;
    resolve?.();
  };

  // Resolves once everything scheduled has played (with a backstop in case an "ended" event never fires).
  const playedOut = () =>
    new Promise<void>((resolve) => {
      if (!sources.size) return resolve();
      const backstop = setTimeout(idle, (playhead - context().currentTime) * 1000 + 1500);
      onIdle = () => {
        clearTimeout(backstop);
        resolve();
      };
    });

  const onMessage = (ws: WebSocket, raw: unknown) => {
    const g = generation;
    if (ws !== socket || !g || typeof raw !== "string") return;
    let msg: { type?: string; context_id?: string; data?: string; message?: string; title?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.context_id && msg.context_id !== g.contextId) return; // a cancelled reply's leftovers
    resetStall();
    if (msg.type === "chunk" && msg.data) {
      const bytes = decodeBase64(msg.data, g.carry);
      const whole = bytes.length - (bytes.length % BYTES_PER_SAMPLE);
      g.carry = whole < bytes.length ? bytes.slice(whole) : null;
      if (whole) schedule(new Float32Array(bytes.buffer, 0, whole / BYTES_PER_SAMPLE));
    } else if (msg.type === "done") {
      g.finish();
    } else if (msg.type === "error") {
      g.finish(new Error(msg.message || msg.title || "Cartesia couldn't speak that"));
    }
  };

  // Resolves when Cartesia has generated the whole reply; its audio may still be playing.
  const generate = async (u: Utterance) => {
    const transcript = toSpeech(u.text);
    if (!transcript) return;
    const started = epoch;
    await unlock();
    const { socket: ws, voiceId: voice } = await open();
    if (epoch !== started) return;
    await new Promise<void>((resolve, reject) => {
      const g: Generation = {
        contextId: `${u.id}-${Date.now().toString(36)}`,
        carry: null,
        finish: (error) => {
          if (generation !== g) return;
          generation = null;
          resetStall();
          if (error) reject(error);
          else resolve();
        },
      };
      generation = g;
      resetStall();
      ws.send(
        JSON.stringify({
          model_id: TTS_MODEL,
          transcript,
          voice,
          language: "en",
          context_id: g.contextId,
          output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: SAMPLE_RATE },
          continue: false,
        }),
      );
    });
  };

  // Replies play one after another, in the order they arrived.
  const drain = async () => {
    if (running) return;
    running = true;
    deps.onSpeakingChange(true);
    try {
      while (queue.length) {
        try {
          await generate(queue.shift()!);
        } catch (e) {
          deps.onError(e as Error);
        }
      }
      await playedOut();
    } finally {
      running = false;
      deps.onSpeakingChange(false);
    }
  };

  const stop = () => {
    epoch++;
    queue.length = 0;
    const g = generation;
    if (g && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ context_id: g.contextId, cancel: true }));
    }
    g?.finish();
    for (const src of sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {}
    }
    sources.clear();
    playhead = 0;
    idle();
  };

  return {
    // Call from a tap: browsers only let audio start after a user gesture.
    prime: () => void context(),
    // Open the socket early so the first reply doesn't wait for a token and a handshake.
    warm: () => void open().catch(() => {}),
    speak: (u) => {
      queue.push(u);
      void drain();
    },
    stop,
    dispose: () => {
      stop();
      const ws = socket;
      socket = null;
      ws?.close();
      void audio?.close().catch(() => {});
      audio = null;
    },
  };
}

function decodeBase64(data: string, carry: Uint8Array<ArrayBuffer> | null): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const offset = carry?.length ?? 0;
  const bytes = new Uint8Array(offset + binary.length);
  if (carry) bytes.set(carry);
  for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
  return bytes;
}
