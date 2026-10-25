# CalHacks2026 — AI Health Assistant

Chat in the app (web + iOS + Android, Expo) or text the Telegram bot. See `plan2.md`.

## Layout
- `App.tsx`, `src/` — Expo app: sign-in, chat, settings (voice mode, "Text me on Telegram").
- `convex/` — backend.
  - `pipeline.ts` — shared pipeline: Jina embed → vector search memory → Cortex triage → Cortex core model + tools → reply.
  - `chat.ts` — app API. `telegram.ts` + `http.ts` — Telegram webhook and account linking. `voice.ts` — Cartesia tokens.
  - `lib/` — Cortex, Jina, Telegram clients and model tools (`web_search`, `read_page`, `bio_research`).
  - `creao.ts` + `lib/creao.ts` — detailed symptom analysis by the CREAO agent (see below).
- `creao/` — the CREAO agent bundle: `SKILL.md` (its program), `config.yaml` (form fields, memory), `README.md`.

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
| `CREAO_API_KEY` | `capi_...` key from the CREAO agent's page on agent.creao.ai |
| `CREAO_WEBHOOK_SECRET` | any long random string; goes in the webhook URL so only CREAO's callbacks are accepted |
| `CREAO_APP_ID` | optional, defaults to the Symptom & Biosensor Health Analyzer (`4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`) |

## CREAO symptom analysis
**Agent:** Symptom & Biosensor Health Analyzer, agent ID `4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`, built on agent.creao.ai (bundle in `creao/`).
**Example run:** _add a share link to one of the agent's runs here (required by the CREAO track)._

When someone asks what could be causing their symptoms, the core model calls `analyze_symptoms`. That starts a CREAO run in the background through the API Trigger, and the report (1-3 ranked conditions, red flags, care guidance, disclaimer) arrives a few minutes later as its own message, in the app or on Telegram.
- **Finishing:** CREAO calls `/creao` on the Convex site when the run ends. The webhook URL carries `CREAO_WEBHOOK_SECRET`, and the result is always re-fetched from CREAO rather than trusted from the webhook body. Polling every minute (up to ~20 minutes) covers missed webhooks and local deployments, which CREAO can't call back.
- **Limits:** one analysis at a time per user and 3 a day, since every run spends CREAO credits.
- **Privacy:** the symptoms and any health data the user shared are sent to CREAO. The model is told to say so when it starts a run.

## Telegram setup
1. `@BotFather` → `/newbot` → token.
2. Register the webhook (needs a public Convex deployment, not local):
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<app>.convex.site/telegram&secret_token=$SECRET"
   ```
