import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { colors } from "./theme";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    // Check the length here so a sign-up failure below can only mean the email is taken.
    if (flow === "signUp" && password.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", { email: email.trim(), password, flow });
    } catch {
      setError(
        flow === "signIn"
          ? "Wrong email or password."
          : "An account with this email already exists. Try signing in.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require("../assets/wellnest-logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Wellnest"
      />
      <Text style={styles.tagline}>Your AI health assistant. Talk or type.</Text>
      <Text style={styles.subtitle}>
        {flow === "signIn" ? "Sign in to continue" : "Create an account"}
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{flow === "signIn" ? "Sign in" : "Sign up"}</Text>
        )}
      </Pressable>
      <Pressable onPress={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}>
        <Text style={styles.link}>
          {flow === "signIn" ? "No account? Sign up" : "Have an account? Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12, maxWidth: 420, width: "100%", alignSelf: "center" },
  logo: { width: 200, height: 151, alignSelf: "center" },
  tagline: { fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: 12 },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: "#fff" },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: colors.primary, textAlign: "center", marginTop: 8 },
  error: { color: colors.danger },
});
