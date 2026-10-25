// iOS/Android: play each reply from the Convex /tts route, an MP3 that Cartesia streams as it speaks.
// The player starts as soon as the first bytes arrive. (Web uses ./speaker.web.ts.)
import { AudioPlayer, createAudioPlayer } from "expo-audio";
import type { CartesiaToken } from "./voice";

export type Utterance = { id: string; text: string };

export type SpeakerDeps = {
  cartesiaToken: () => Promise<CartesiaToken>; // web: opens the Cartesia WebSocket
  authToken: () => string | null; // native: the Convex auth token for /tts
  onSpeaking: (messageId: string | null) => void; // the reply being spoken, or null when quiet
  onError: (error: Error) => void;
};

export type Speaker = {
  prime: () => void;
  warm: () => void;
  speak: (u: Utterance) => void;
  stop: () => void;
  dispose: () => void;
};

const SITE_URL =
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? process.env.EXPO_PUBLIC_CONVEX_URL!.replace(/\.cloud$/, ".site");
const STALL_MS = 20_000; // nothing playing for this long: give up on the reply

export function createSpeaker(deps: SpeakerDeps): Speaker {
  const queue: Utterance[] = [];
  let player: AudioPlayer | null = null;
  let finishCurrent: (() => void) | null = null;
  let running = false;

  const say = (u: Utterance) =>
    new Promise<void>((resolve, reject) => {
      const token = deps.authToken();
      if (!token) return reject(new Error("Not signed in"));
      const p = createAudioPlayer({
        uri: `${SITE_URL}/tts?message=${encodeURIComponent(u.id)}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      player = p;
      let stall = setTimeout(() => done(new Error("Speech timed out")), STALL_MS);
      const done = (error?: Error) => {
        clearTimeout(stall);
        sub.remove();
        p.remove();
        if (player === p) player = null;
        finishCurrent = null;
        if (error) reject(error);
        else resolve();
      };
      finishCurrent = () => done();
      const sub = p.addListener("playbackStatusUpdate", (s) => {
        if (s.error) return done(new Error(s.error));
        if (s.didJustFinish) return done();
        if (s.playing) {
          clearTimeout(stall);
          stall = setTimeout(() => done(new Error("Speech timed out")), Math.max(STALL_MS, (s.duration - s.currentTime) * 1000 + 5000));
        }
      });
      p.play();
    });

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const next = queue.shift()!;
        deps.onSpeaking(next.id);
        try {
          await say(next);
        } catch (e) {
          deps.onError(e as Error);
        }
      }
    } finally {
      running = false;
      deps.onSpeaking(null);
    }
  };

  const stop = () => {
    queue.length = 0;
    player?.pause();
    finishCurrent?.();
  };

  return {
    prime: () => {},
    warm: () => {},
    speak: (u) => {
      queue.push(u);
      void drain();
    },
    stop,
    dispose: stop,
  };
}
