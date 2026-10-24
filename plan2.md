# Plan 2

AI health assistant. Use it in the app (web + mobile) or just text it on Telegram.

## Stack
| Part | Tool |
|---|---|
| App (web + iOS + Android) | React Native with Expo (one codebase) |
| Backend + DB | Convex (JS functions, HTTP actions for webhooks) |
| LLM | Snowflake Cortex REST API (key coming) |
| Embeddings | Jina (makes the vectors) |
| Vector storage + search | Convex vector index (data + user prompts) |
| Web search / bio research | Jina Search + Reader APIs, called as tools by the core model |
| Voice | Cartesia (STT in, TTS out) |
| Texting | Telegram bot |
| Domain (later) | GoDaddy |

## How it works
1. User sends a message (app, voice, or Telegram).
2. Convex saves it, embeds it with Jina, and pulls related past data (vector search).
3. A small Cortex model triages it: is this medical? urgent?
4. The core model answers. If it needs info, it calls tools:
   - `web_search` / `read_page` (Jina)
   - `bio_research` (search + summarize papers/sources)
5. Reply goes back to the same channel. If voice is on, Cartesia speaks it.

## Texting: Telegram
A Telegram bot is a chat account your code controls. Users text it like a friend.

**Setup (one time):**
1. In Telegram, message `@BotFather` and send `/newbot`. Pick a name and you get a **bot token**.
2. Tell Telegram where to send messages with `setWebhook`, pointing at a Convex URL (`https://<app>.convex.site/telegram`).

**Each message:**
1. The user texts the bot.
2. Telegram POSTs the message to your Convex URL.
3. Convex runs the normal pipeline (store + embed with Jina, search, answer).
4. Convex sends the reply back with Telegram's `sendMessage` API.

**One bot for everyone:**
- Every user gets their own private chat with the bot, so conversations are already separate.
- Bots can't be created automatically (BotFather is manual), and we don't need one per user anyway.

**Accounts (no annoying linking):**
- **Telegram-only users:** first message creates their account automatically. No signup.
- **App users who want Telegram:** one tap on "Text me on Telegram" opens the bot. They press Start and they're linked (`t.me/<bot>?start=<code>`).
- Optional later: "Log in with Telegram" on the web, which links automatically.

**Why Telegram:** free, no app review, and the bot can text users first anytime (reminders, follow-ups).

## Voice: Cartesia
- Only runs if the user turns on "Voice mode" in settings (stored in Convex).
- In: mic audio → Cartesia STT → text → same pipeline.
- Out: reply text → Cartesia TTS (Sonic) → play in the app.
- Convex issues short-lived Cartesia tokens so the API key never ships in the app.

## Embeddings (Jina, in MVP)
Only **chat messages** get embeddings: user ↔ bot on Telegram and user ↔ assistant in the app/web. Nothing else.
- Store: message text → Jina → vector → save `{ userId, role, text, embedding, channel }` in a Convex `messages` table.
- Search: new message → Jina → vector → Convex vector search → top matches go to the model.
- Convex doesn't make embeddings, it only stores and searches them. Jina makes them.

**Why you'd use Elasticsearch instead (not for MVP):**
- Hybrid search: keyword (BM25) + vector together. Better results for exact terms like drug names or lab codes.
- Can make embeddings itself (`semantic_text` field with a Jina inference endpoint), so there's no separate embed step.
- Built-in reranking, heavy filtering, and scale to millions of docs.
- Counts for the Elastic/Jina prize.
- Downside: another service to run. Convex is enough for the MVP.

## Decisions
- **Auth:** Convex Auth (email/Google) for app + web. Telegram users get auto accounts.
- **Urgent triage:** warn the user, tell them to seek care or call 911, and show nearby urgent care (via web search).
- **Build order:** app/web chat first, then Telegram on the same pipeline.
- **Start:** wait for the Snowflake key before building.

## Not doing now
- Creao / Fetch agents (built later, called by endpoint)
- Apify (the core model does search through Jina for now)
- Shopping (Fetch/Visa)
- Commit Fellowship, Microsoft
- Elasticsearch
- Deploying (GoDaddy domain later)

## Build order
1. Expo app + Convex setup, chat screen.
2. Cortex chat (once the Snowflake key arrives).
3. Jina embeddings + Convex vector search for memory.
4. Web search + bio research tools.
5. Telegram bot webhook.
6. Cartesia voice toggle.

## Keys needed
`SNOWFLAKE_*`, `JINA_API_KEY`, `CARTESIA_API_KEY`, `TELEGRAM_BOT_TOKEN`
