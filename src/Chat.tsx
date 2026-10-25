import { useRef, useState } from "react";
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
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import { useVoice } from "./useVoice";
import { Markdown } from "./Markdown";
import { PulseRing, ThinkingDots } from "./Motion";

// One tap sends these from the empty chat, so first-time users (and judges) can try it right away.
const STARTERS = [
  "I have a mild headache, what should I do?",
  "My allergies are acting up today",
  "How much water should I drink a day?",
  "I just got my period and the cramps are bad",
];

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
    voice.prepare();
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
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="pulse" size={20} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Health Assistant</Text>
            <Text style={styles.headerSubtitle}>
              {me?.voiceMode ? "Voice on · talk or type" : "Text mode"} · not a doctor
            </Text>
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          onPress={() => setShowSettings((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel={showSettings ? "Close settings" : "Settings"}
        >
          <Ionicons name={showSettings ? "close" : "settings-outline"} size={22} color={colors.text} />
        </Pressable>
      </View>

      {showSettings && me && <Settings me={me} onVoiceModeOn={() => voice.prepare(true)} />}

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
            <View style={styles.welcome}>
              <View style={styles.welcomeIcon}>
                <Ionicons name={me?.voiceMode ? "mic" : "chatbubble-ellipses"} size={30} color={colors.primary} />
              </View>
              <Text style={styles.welcomeTitle}>How are you feeling?</Text>
              <Text style={styles.empty}>
                {me?.voiceMode ? "Tap the mic and just talk, or type below." : "Type a question below."} I'm not a
                doctor; in an emergency call 911.
              </Text>
              <View style={styles.chips}>
                {STARTERS.map((q) => (
                  <Pressable
                    key={q}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    onPress={() => void submit(q)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
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
              {item.channel === "telegram" && (
                <Text style={styles.channel}>{item.voice ? "Voice note via Telegram" : "via Telegram"}</Text>
              )}
              {item._id === voice.speakingId && (
                <Pressable
                  style={styles.speaking}
                  onPress={voice.stopSpeaking}
                  accessibilityRole="button"
                  accessibilityLabel="Speaking. Tap to stop."
                >
                  <Ionicons name="volume-high" size={14} color={colors.primary} />
                  <Text style={styles.speakingText}>Speaking · tap to stop</Text>
                </Pressable>
              )}
            </View>
          )}
          ListFooterComponent={
            waiting ? (
              <View style={[styles.bubble, styles.botBubble, styles.thinking]}>
                <ThinkingDots />
              </View>
            ) : undefined
          }
        />
      )}

      <View style={styles.inputRow}>
        {me?.voiceMode && (
          <View>
            {voice.mic === "recording" && <PulseRing color={colors.danger} style={styles.ring} />}
            <Pressable
              style={({ pressed }) => [
                styles.iconButton,
                styles.mic,
                voice.mic === "recording" && styles.micActive,
                pressed && styles.pressed,
              ]}
              onPress={voice.mic === "recording" ? voice.stop : voice.start}
              disabled={voice.mic === "asking" || voice.mic === "transcribing"}
              accessibilityRole="button"
              accessibilityLabel={voice.mic === "recording" ? "Stop recording and send" : "Record a voice message"}
              accessibilityState={{ busy: voice.mic === "asking" || voice.mic === "transcribing" }}
            >
              {voice.mic === "asking" || voice.mic === "transcribing" ? (
                <ActivityIndicator color={colors.primary} />
              ) : voice.mic === "recording" ? (
                <Ionicons name="stop" size={20} color="#fff" />
              ) : (
                <Ionicons name="mic" size={22} color={colors.primary} />
              )}
            </Pressable>
          </View>
        )}
        <TextInput
          style={styles.input}
          placeholder={me?.voiceMode ? "Type or tap the mic" : "Type a message"}
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [styles.iconButton, styles.send, !text.trim() && styles.sendIdle, pressed && styles.pressed]}
          onPress={() => submit()}
          disabled={!text.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={22} color="#fff" />
        </Pressable>
      </View>
      {notice && <Text style={styles.error}>{notice}</Text>}
      {voice.status && (
        <View style={styles.noteRow}>
          <Text style={[styles.voiceStatus, styles.noteText]} accessibilityLiveRegion="polite">
            {voice.status}
          </Text>
        </View>
      )}
      {voice.error && (
        <View style={styles.noteRow}>
          <Text style={[styles.error, styles.noteText]} accessibilityLiveRegion="assertive">
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
  onVoiceModeOn,
}: {
  me: { email: string | null; voiceMode: boolean; telegramLinked: boolean; location: string };
  onVoiceModeOn: () => void;
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
        <Switch
          value={me.voiceMode}
          onValueChange={(enabled) => {
            void setVoiceMode({ enabled });
            if (enabled) onVoiceModeOn();
          }}
        />
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
  headerSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  headerButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerLink: { color: colors.primary, fontSize: 16 },
  settings: { padding: 16, gap: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { fontSize: 16, color: colors.text },
  locationInput: { flex: 1, marginLeft: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  settingButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center" },
  settingButtonText: { color: colors.primary, fontWeight: "600" },
  muted: { color: colors.muted },
  list: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  empty: { color: colors.muted, textAlign: "center", lineHeight: 20, maxWidth: 340 },
  welcome: { alignItems: "center", marginTop: 32, gap: 10, paddingHorizontal: 8 },
  welcomeIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  welcomeTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8, maxWidth: 560 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { color: colors.text, fontSize: 14 },
  speaking: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  speakingText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  thinking: { paddingVertical: 10, marginTop: 8 },
  ring: { borderRadius: 22 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  userBubble: { backgroundColor: colors.bubbleUser, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: colors.bubbleBot, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  urgentBubble: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  userText: { color: "#fff", fontSize: 16 },
  botText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  channel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    paddingBottom: 28,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.bg,
  },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  send: { backgroundColor: colors.primary },
  sendIdle: { backgroundColor: colors.border },
  mic: { backgroundColor: colors.primarySoft },
  micActive: { backgroundColor: colors.danger },
  error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 8 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 16 },
  noteText: { flex: 1 },
  errorAction: { color: colors.primary, fontWeight: "600", paddingBottom: 8 },
  voiceStatus: { color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 },
});
