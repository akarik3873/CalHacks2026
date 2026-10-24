// Minimal Markdown for chat bubbles: headings, bullets, **bold**, *italic*, `code`, [links](url).
import { Linking, StyleSheet, Text, TextStyle, View } from "react-native";
import { colors } from "./theme";

export function Markdown({ text, style }: { text: string; style: TextStyle }) {
  return (
    <View style={styles.block}>
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return <Text key={i} style={[style, styles.bold]}>{inline(heading[1], style)}</Text>;
        const bullet = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (bullet) {
          const marker = /\d/.test(bullet[2]) ? bullet[2] : "•";
          return (
            <View key={i} style={[styles.row, { paddingLeft: bullet[1].length * 6 }]}>
              <Text style={[style, styles.marker]}>{marker}</Text>
              <Text style={[style, styles.flex]}>{inline(bullet[3], style)}</Text>
            </View>
          );
        }
        if (!line.trim()) return <View key={i} style={styles.gap} />;
        return <Text key={i} style={style}>{inline(line, style)}</Text>;
      })}
    </View>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_]+?(?<!\s)_(?![\w_]))/g;

function inline(text: string, style: TextStyle) {
  return text.split(TOKEN).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith("**") || part.startsWith("__")) return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
    if (part.startsWith("`")) return <Text key={i} style={styles.code}>{part.slice(1, -1)}</Text>;
    const link = part.match(/^\[([^\]]+)\]\((.+)\)$/);
    if (link) {
      return (
        <Text key={i} style={[styles.link, { color: style.color === "#fff" ? "#fff" : colors.primary }]} onPress={() => Linking.openURL(link[2])}>
          {link[1]}
        </Text>
      );
    }
    return <Text key={i} style={styles.italic}>{part.slice(1, -1)}</Text>;
  });
}

const styles = StyleSheet.create({
  block: { gap: 2 },
  row: { flexDirection: "row", gap: 6 },
  marker: { minWidth: 12 },
  flex: { flex: 1 },
  gap: { height: 6 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: "Courier", backgroundColor: "#F3F4F6" },
  link: { textDecorationLine: "underline" },
});
