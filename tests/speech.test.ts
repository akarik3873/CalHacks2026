import { describe, expect, test } from "vitest";
import { toSpeech } from "../convex/lib/speech";

describe("toSpeech", () => {
  test("strips Markdown and keeps link labels, dropping URLs", () => {
    const md = [
      "## Headache tips",
      "- **Rest** in a *dark*, quiet room",
      "- Drink water (see [CDC](https://cdc.gov/x?a=1&b=2))",
      "1. Try `acetaminophen` if needed",
      "> Not medical advice",
      "Source: https://example.com/page",
      "---",
    ].join("\n");
    expect(toSpeech(md)).toBe(
      "Headache tips. Rest in a dark, quiet room. Drink water (see CDC). Try acetaminophen if needed. Not medical advice.",
    );
  });

  test("leaves arithmetic and snake_case alone", () => {
    expect(toSpeech("2 * 3 * 4 and snake_case_name")).toBe("2 * 3 * 4 and snake_case_name.");
  });

  test("separators become pauses and code blocks are skipped", () => {
    expect(toSpeech("Stores: Amazon · Walmart\n```js\nx()\n```\nDone!")).toBe("Stores: Amazon, Walmart. Done!");
  });

  test("long replies stop at a sentence and point to the text", () => {
    const sentence = "Drink plenty of water and rest today. ";
    const spoken = toSpeech(sentence.repeat(100), 400);
    expect(spoken.length).toBeLessThanOrEqual(400 + 30);
    expect(spoken).toMatch(/today\. The rest is in the text\.$/);
  });

  test("a reply with nothing to say speaks nothing", () => {
    expect(toSpeech("https://example.com\n---\n")).toBe("");
  });
});
