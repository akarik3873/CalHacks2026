// Turn a Markdown reply into text that sounds right when Cartesia reads it aloud.
// Shared by the app (streaming TTS) and the server (Telegram voice notes, the native TTS stream), so it
// avoids regex features Hermes may lack (lookbehind, Unicode property escapes).

// Cartesia's TTS model and the voice used when CARTESIA_VOICE_ID isn't set.
export const TTS_MODEL = "sonic-3.6";
export const DEFAULT_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
// About three minutes of speech. Longer replies stop at a sentence break and point to the text.
export const MAX_SPEECH_CHARS = 2500;

export function toSpeech(markdown: string, max = MAX_SPEECH_CHARS): string {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, " ") // code blocks don't read well
    .split("\n")
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
        .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1") // links keep their label
        .replace(/<?https?:\/\/[^\s>)]+>?/g, "") // bare URLs
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/, "") // headings
        .replace(/^\s*>\s?/, "") // quotes
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "") // list markers
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\w)/g, "$1$2")
        .replace(/(^|[^_\w])_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/g, "$1$2")
        .replace(/\s*[·|]\s*/g, ", ")
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    // Drop lines that are only punctuation, and "Sources:" labels whose links were removed.
    .filter((line) => /[^\s!-\/:-@[-`{-~]/.test(line) && !/^(sources?|references?|links?|read more)\s*:?$/i.test(line));
  // Each line becomes a sentence so list items and headings get a pause instead of running together.
  const text = lines.map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`)).join(" ");
  return truncate(text, max);
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`} The rest is in the text.`;
}
