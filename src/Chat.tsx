import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import { CartesiaToken, speak, transcribe } from "./voice";
import { Markdown } from "./Markdown";

export function Chat() {
  const messages = useQuery(api.chat.list);
  const me = useQuery(api.chat.me);
  const send = useMutation(api.chat.send);
  const [text, setText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const last = messages?.[messages.length - 1];
  const waiting = last?.role === "user";

  const submit = async (value = text) => {
    if (!value.trim()) return;
    setText("");
    setNotice(null);
    const res = await send({ text: value });
    if (res.limited) {
      setText(value);
      setNotice(`You've reached today's limit of ${res.limit} messages. Please try again tomorrow. In an emergency, call 911.`);
    }
  };

  const voice = useVoice(!!me?.voiceMode, messages, submit);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Health Assistant</Text>
        <Pressable onPress={() => setShowSettings((s) => !s)}>
          <Text style={styles.headerLink}>{showSettings ? "Done" : "Settings"}</Text>
        </Pressable>
      </View>

      {showSettings && me && <Settings me={me} />}

      {messages === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m._id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Ask me anything about your health. I'm not a doctor; in an emergency call 911.
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.botBubble,
                item.urgent && styles.urgentBubble,
              ]}
            >
              {item.role === "user" ? (
                <Text style={styles.userText}>{item.text}</Text>
              ) : (
                <Markdown text={item.text} style={styles.botText} />
              )}
              {item.channel === "telegram" && <Text style={styles.channel}>via Telegram</Text>}
            </View>
          )}
          ListFooterComponent={waiting ? <Text style={styles.typing}>Thinking…</Text> : undefined}
        />
      )}

      <View style={styles.inputRow}>
        {me?.voiceMode && (
          <Pressable
            style={[styles.mic, voice.mic === "recording" && styles.micActive]}
            onPress={voice.mic === "recording" ? voice.stop : voice.start}
            disabled={voice.mic === "asking" || voice.mic === "transcribing"}
            accessibilityRole="button"
            accessibilityLabel={voice.mic === "recording" ? "Stop recording and send" : "Record a voice message"}
            accessibilityState={{ busy: voice.mic === "asking" || voice.mic === "transcribing" }}
          >
            {voice.mic === "asking" || voice.mic === "transcribing" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.micText}>{voice.mic === "recording" ? "Stop" : "Mic"}</Text>
            )}
          </Pressable>
        )}
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          returnKeyType="send"
        />
        <Pressable style={styles.send} onPress={() => submit()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
      {notice && <Text style={styles.error}>{notice}</Text>}
      {voice.status && (
        <Text style={styles.voiceStatus} accessibilityLiveRegion="polite">
          {voice.status}
        </Text>
      )}
      {voice.error && (
        <View style={styles.errorRow}>
          <Text style={[styles.error, styles.errorText]} accessibilityLiveRegion="assertive">
            {voice.error.text}
          </Text>
          {voice.error.openSettings && (
            <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
              <Text style={styles.errorAction}>Open Settings</Text>
            </Pressable>
          )}
          <Pressable onPress={voice.dismissError} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={styles.errorAction}>✕</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Settings({
  me,
}: {
  me: { email: string | null; voiceMode: boolean; telegramLinked: boolean; location: string };
}) {
  const setVoiceMode = useMutation(api.chat.setVoiceMode);
  const setLocation = useMutation(api.chat.setLocation);
  const [location, setLocationText] = useState(me.location);
  const saveLocation = () => {
    if (location.trim() !== me.location) void setLocation({ location });
  };
  const createLinkUrl = useMutation(api.telegram.createLinkUrl);
  const { signOut } = useAuthActions();
  const [error, setError] = useState<string | null>(null);

  const openTelegram = async () => {
    try {
      await Linking.openURL(await createLinkUrl());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={styles.settings}>
      <Text style={styles.muted}>{me.email}</Text>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Voice mode</Text>
        <Switch value={me.voiceMode} onValueChange={(enabled) => void setVoiceMode({ enabled })} />
      </View>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Location</Text>
        <TextInput
          style={styles.locationInput}
          placeholder="City or zip (for nearby care)"
          value={location}
          onChangeText={setLocationText}
          onBlur={saveLocation}
          onSubmitEditing={saveLocation}
          returnKeyType="done"
        />
      </View>
      <Pressable style={styles.settingButton} onPress={openTelegram}>
        <Text style={styles.settingButtonText}>
          {me.telegramLinked ? "Telegram linked ✓ (open bot)" : "Text me on Telegram"}
        </Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={() => void signOut()}>
        <Text style={styles.headerLink}>Sign out</Text>
      </Pressable>
    </View>
  );
}

// Voice input steps: waiting on the permission prompt, recording, then transcribing.
type MicState = "idle" | "asking" | "recording" | "transcribing";

const MAX_RECORDING_MS = 2 * 60_000;
const MIC_STATUS: Record<MicState, string | null> = {
  idle: null,
  asking: "Waiting for microphone permission…",
  recording: "Listening… tap Stop when you're done.",
  transcribing: "Transcribing…",
};

type VoiceError = { text: string; openSettings?: boolean };

// Turn recorder and permission failures into something the user can act on.
function micError(e: unknown): VoiceError {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return micBlocked();
  if (name === "NotFoundError" || name === "OverconstrainedError") return { text: "No microphone found." };
  if (name === "NotReadableError") return { text: "Your microphone is being used by another app." };
  return { text: `Couldn't start recording: ${(e as Error)?.message ?? String(e)}` };
}

function micBlocked(): VoiceError {
  return Platform.OS === "web"
    ? { text: "Microphone access is blocked. Allow it in your browser's site settings, then tap Mic again." }
    : { text: "Microphone access is off for Health Assistant.", openSettings: true };
}

// Mic -> Cartesia STT -> send; new assistant replies -> Cartesia TTS while voice mode is on.
function useVoice(
  enabled: boolean,
  messages: { _id: string; role: string; text: string }[] | undefined,
  submit: (text: string) => Promise<void>,
) {
  const getToken = useAction(api.voice.token);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [mic, setMicState] = useState<MicState>("idle");
  const [error, setError] = useState<VoiceError | null>(null);
  const tokenRef = useRef<{ value: CartesiaToken; at: number } | null>(null);
  const spoken = useRef<Set<string> | null>(null);
  // The state is mirrored in a ref so double taps and timers see the latest step, not a stale render's.
  const micRef = useRef<MicState>("idle");
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMic = (next: MicState) => {
    micRef.current = next;
    setMicState(next);
  };

  const token = async () => {
    // Tokens last 5 min; refresh after 4.
    if (!tokenRef.current || Date.now() - tokenRef.current.at > 4 * 60_000) {
      tokenRef.current = { value: await getToken(), at: Date.now() };
    }
    return tokenRef.current.value;
  };

  useEffect(() => {
    if (!messages) return;
    // Don't read out history on first load, only replies that arrive later.
    if (!spoken.current) {
      spoken.current = new Set(messages.map((m) => m._id));
      return;
    }
    for (const m of messages) {
      if (spoken.current.has(m._id)) continue;
      spoken.current.add(m._id);
      if (enabled && m.role === "assistant") {
        token()
          .then((t) => speak(t, m.text))
          .catch((e) => setError({ text: `Couldn't play the reply: ${(e as Error).message}` }));
      }
    }
  }, [messages, enabled]);

  const clearAutoStop = () => {
    if (autoStop.current) clearTimeout(autoStop.current);
    autoStop.current = null;
  };

  // Stop the recorder and hand recording back to playback; never throws.
  const release = async () => {
    clearAutoStop();
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (e) {
      console.warn("recorder.stop failed", e);
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  };

  const start = async () => {
    if (micRef.current !== "idle") return;
    setError(null);
    // Browsers only expose the microphone on https (or localhost) pages.
    if (Platform.OS === "web" && typeof window !== "undefined" && !window.isSecureContext) {
      setError({ text: "Voice input needs a secure (https) page." });
      return;
    }
    setMic("asking");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMic("idle");
        setError(perm.canAskAgain && Platform.OS !== "web"
          ? { text: "Voice input needs microphone access. Tap Mic to try again." }
          : micBlocked());
        return;
      }
      // Voice mode may have been switched off while the prompt was open.
      if ((micRef.current as MicState) !== "asking") return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setMic("recording");
      autoStop.current = setTimeout(() => void stop(), MAX_RECORDING_MS);
    } catch (e) {
      console.error("starting a recording failed", e);
      await release();
      setMic("idle");
      setError(micError(e));
    }
  };

  const stop = async () => {
    if (micRef.current !== "recording") return;
    clearAutoStop();
    setMic("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri) throw new Error("No recording");
      const text = (await transcribe(await token(), recorder.uri)).trim();
      if (text) await submit(text);
      else setError({ text: "I didn't catch anything. Tap Mic and try again." });
    } catch (e) {
      console.error("voice input failed", e);
      setError({ text: "Couldn't transcribe that. Please try again, or type your message instead." });
    } finally {
      setMic("idle");
    }
  };

  // Switching voice mode off (or leaving the screen) mid-recording discards the recording.
  useEffect(() => {
    if (enabled) return;
    if (micRef.current === "recording" || micRef.current === "asking") {
      setMic("idle");
      void release();
    }
  }, [enabled]);
  useEffect(() => () => void release(), []);

  return {
    mic,
    status: MIC_STATUS[mic],
    error,
    start: () => void start(),
    stop: () => void stop(),
    dismissError: () => setError(null),
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  headerLink: { color: colors.primary, fontSize: 16 },
  settings: { padding: 16, gap: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { fontSize: 16, color: colors.text },
  locationInput: { flex: 1, marginLeft: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  settingButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center" },
  settingButtonText: { color: colors.primary, fontWeight: "600" },
  muted: { color: colors.muted },
  list: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  empty: { color: colors.muted, textAlign: "center", marginTop: 40 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  userBubble: { backgroundColor: colors.bubbleUser, alignSelf: "flex-end" },
  botBubble: { backgroundColor: colors.bubbleBot, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border },
  urgentBubble: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  userText: { color: "#fff", fontSize: 16 },
  botText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  channel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  typing: { color: colors.muted, fontStyle: "italic", marginTop: 4 },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 16, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "600" },
  mic: { backgroundColor: colors.muted, borderRadius: 20, paddingHorizontal: 14, justifyContent: "center" },
  micActive: { backgroundColor: colors.danger },
  micText: { color: "#fff", fontWeight: "600" },
  error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 8 },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 16 },
  errorText: { flex: 1 },
  errorAction: { color: colors.primary, fontWeight: "600", paddingBottom: 8 },
  voiceStatus: { color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 },
});
