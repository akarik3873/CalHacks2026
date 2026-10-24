import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";

// Demo persona. Real sign-in comes later.
const USER_ID = "maya";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

export default function App() {
  return (
    <ConvexProvider client={convex}>
      <Chat />
      <StatusBar style="auto" />
    </ConvexProvider>
  );
}

function Chat() {
  const messages = useQuery(api.messages.list, { userId: USER_ID });
  const send = useMutation(api.messages.send);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    void send({ userId: USER_ID, text: draft });
    setDraft("");
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.header}>Signal</Text>
      {messages === undefined ? (
        <ActivityIndicator style={styles.list} />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={messages}
          keyExtractor={(m) => m._id}
          renderItem={({ item }) => <Message message={item} />}
          ListEmptyComponent={<Text style={styles.empty}>Ask about your health data, e.g. "Why have I been so tired lately?"</Text>}
        />
      )}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder="Message Signal"
          returnKeyType="send"
        />
        <Pressable style={styles.send} onPress={submit} accessibilityRole="button" accessibilityLabel="Send">
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Message({ message }: { message: Doc<"messages"> }) {
  const [showSteps, setShowSteps] = useState(false);
  const isUser = message.role === "user";
  const toolCalls = (message.steps ?? []).filter((s) => s.type === "tool_call");

  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble]}>
      {message.status === "thinking" ? (
        <Text style={styles.muted}>Looking through your data…</Text>
      ) : (
        <Text style={[styles.text, isUser && styles.userText, message.status === "error" && styles.error]}>{message.text}</Text>
      )}
      {toolCalls.length > 0 && (
        <Pressable onPress={() => setShowSteps(!showSteps)} accessibilityRole="button">
          <Text style={styles.stepsToggle}>
            {showSteps ? "▾" : "▸"} Checked {toolCalls.length} {toolCalls.length === 1 ? "source" : "sources"}
          </Text>
        </Pressable>
      )}
      {showSteps &&
        toolCalls.map((s, i) => (
          <Text key={i} style={styles.step}>
            {s.toolId?.replace(/^signal_/, "")} {s.params && Object.keys(s.params).length ? JSON.stringify(s.params) : ""}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f7f5", paddingTop: Platform.OS === "web" ? 16 : 56 },
  header: { fontSize: 22, fontWeight: "700", paddingHorizontal: 16, paddingBottom: 8 },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 10 },
  empty: { color: "#777", textAlign: "center", marginTop: 40 },
  bubble: { maxWidth: "85%", borderRadius: 14, padding: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#1f6feb" },
  agentBubble: { alignSelf: "flex-start", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e3e3e0" },
  text: { fontSize: 16, lineHeight: 22, color: "#1b1b1b" },
  userText: { color: "#fff" },
  error: { color: "#b42318" },
  muted: { color: "#777", fontStyle: "italic" },
  stepsToggle: { marginTop: 8, color: "#1f6feb", fontWeight: "600" },
  step: { marginTop: 4, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12, color: "#555" },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: "#e3e3e0", backgroundColor: "#fff" },
  input: { flex: 1, borderWidth: 1, borderColor: "#d0d0cc", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { justifyContent: "center", paddingHorizontal: 16, borderRadius: 20, backgroundColor: "#1f6feb" },
  sendText: { color: "#fff", fontWeight: "600" },
});
