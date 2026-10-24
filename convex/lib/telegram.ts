import { env } from "./env";

const MAX_CHUNK = 3500; // Telegram caps messages at 4096 chars; leave room for HTML tags.

export async function call(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function sendTelegram(chatId: string, text: string) {
  for (const chunk of chunkText(text)) {
    let res = await call("sendMessage", {
      chat_id: chatId,
      text: markdownToTelegramHtml(chunk),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    // If Telegram can't parse our HTML, fall back to plain text rather than dropping the reply.
    if (res.status === 400) res = await call("sendMessage", { chat_id: chatId, text: chunk });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}

export async function sendTyping(chatId: string) {
  await call("sendChatAction", { chat_id: chatId, action: "typing" });
}

// Split on line boundaries so Markdown formatting isn't cut mid-span.
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const pieces = line.length > max ? line.match(new RegExp(`.{1,${max}}`, "g"))! : [line];
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > max) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Model replies use simple Markdown; Telegram's HTML mode is the most forgiving way to render it.
export function markdownToTelegramHtml(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return `<b>${inline(heading[1])}</b>`;
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (bullet) return `${bullet[1]}• ${inline(bullet[2])}`;
      return inline(line);
    })
    .join("\n");
}

function inline(text: string): string {
  // Pull out code spans and links first so their contents aren't re-formatted.
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
      hold(`<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${escapeHtml(label)}</a>`),
    );
  s = escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

// Linking confirmation: Yes/No buttons. callback_data must stay under 64 bytes.
export async function sendLinkPrompt(chatId: string, text: string, linkId: string) {
  const res = await call("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: "Yes, link", callback_data: `link:yes:${linkId}` },
        { text: "No", callback_data: `link:no:${linkId}` },
      ]],
    },
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

// Stop the button spinner and replace the prompt (and its buttons) with the outcome.
export async function finishLinkPrompt(opts: {
  callbackId: string;
  chatId: string;
  messageId?: number;
  text: string;
}) {
  await call("answerCallbackQuery", { callback_query_id: opts.callbackId });
  if (opts.messageId !== undefined) {
    await call("editMessageText", { chat_id: opts.chatId, message_id: opts.messageId, text: opts.text });
  }
}
