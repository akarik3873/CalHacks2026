# CalHacks2026 — AI Health Assistant

Chat in the app (web + iOS + Android, Expo) or text the Telegram bot. See `plan2.md`.

## Layout
- `App.tsx`, `src/` — Expo app: sign-in, chat, settings (voice mode, "Text me on Telegram").
- `convex/` — backend.
  - `pipeline.ts` — shared pipeline: Jina embed → vector search memory → Cortex triage → Cortex core model + tools → reply.
  - `chat.ts` — app API. `telegram.ts` + `http.ts` — Telegram webhook and account linking. `voice.ts` — Cartesia tokens.
  - `lib/` — Cortex, Jina, Telegram clients and model tools (`web_search`, `read_page`, `bio_research`).
- `agents/` — Health Supply Shopper, a Fetch.ai agent used in ASI:One that restocks OTC health supplies (Python, runs separately). Agent addresses and setup: [`agents/README.md`](agents/README.md).

## Run
```bash
npm install
npx convex dev          # backend (writes EXPO_PUBLIC_CONVEX_URL to .env.local)
npx expo start --web    # or press i / a for iOS / Android
```
Voice recording needs a development build on native (`npx expo run:ios`), not Expo Go.

## Convex env vars (`npx convex env set NAME value`)
| Var | What |
|---|---|
| `SNOWFLAKE_ACCOUNT_URL` | `https://<account-identifier>.snowflakecomputing.com` |
| `SNOWFLAKE_PAT` | Snowflake programmatic access token |
| `CORTEX_TRIAGE_MODEL` / `CORTEX_CORE_MODEL` | optional, default `llama3.1-8b` / `openai-gpt-5.4` (core must be a Claude/OpenAI model for tools) |
| `JINA_API_KEY` | embeddings, search, reader |
| `CARTESIA_API_KEY` | voice; optional `CARTESIA_VOICE_ID` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | bot |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | Convex Auth (`npx @convex-dev/auth` sets these) |

## Telegram setup
1. `@BotFather` → `/newbot` → token.
2. Register the webhook (needs a public Convex deployment, not local):
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<app>.convex.site/telegram&secret_token=$SECRET"
   ```
