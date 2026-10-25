// Small looping animations for the chat: the "thinking" dots and the ring that pulses around the mic while recording.
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View, ViewStyle } from "react-native";
import { colors } from "./theme";

const native = Platform.OS !== "web";

export function ThinkingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: native }),
            Animated.timing(d, { toValue: 0.3, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: native }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View style={styles.dots} accessibilityLabel="Thinking" accessibilityRole="progressbar">
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { opacity: d, transform: [{ translateY: d.interpolate({ inputRange: [0.3, 1], outputRange: [0, -3] }) }] }]}
        />
      ))}
    </View>
  );
}

// A ring that grows and fades behind its parent, sized to fill it (parent needs position: relative).
export function PulseRing({ color, style }: { color: string; style?: ViewStyle }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: native }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        style,
        {
          backgroundColor: color,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
});
