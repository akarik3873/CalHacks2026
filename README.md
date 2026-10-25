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
  - `shop.ts` + `lib/shopping/` — Health Supply Shopper: Amazon and Walmart links for OTC health supplies (see below).
  - `lib/jev.ts` — routes each message: shopping, symptom analyzer, or regular.

## Live
- **Web app:** https://merry-capybara-181.convex.site (Expo web build served by Convex static hosting, on the dev deployment). Redeploy with `npm run deploy:web`.
- **Telegram:** [@calhacks2026_bot](https://t.me/calhacks2026_bot).

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
| `CORTEX_SHOPPER_MODEL` / `CORTEX_CORE_MODEL` | optional, default `claude-haiku-4-5` / `openai-gpt-5.4` (core must be a Claude/OpenAI model for tools) |
| `JINA_API_KEY` | embeddings, search, reader |
| `CARTESIA_API_KEY` | voice; optional `CARTESIA_VOICE_ID` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | bot |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | Convex Auth (`npx @convex-dev/auth` sets these) |
| `CREAO_API_KEY` | `capi_...` key from the CREAO agent's page on agent.creao.ai |
| `CREAO_WEBHOOK_SECRET` | any long random string; goes in the webhook URL so only CREAO's callbacks are accepted |
| `CREAO_APP_ID` | optional, defaults to the Symptom & Biosensor Health Analyzer (`4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`) |
| `JEV_API_KEY` | TypeSafe Jev key; routes each message (optional `JEV_MODEL`, default `jev-latest`) |
| `CORTEX_SHOPPER_MODEL` | optional; the Snowflake model that reads shopping requests (default: the triage model) |

## Routing (Jev)
Before the model runs, `convex/lib/jev.ts` asks Jev yes/no questions about the message (plus the assistant's previous message):
- **Shopping (proactive):** a period, headache, allergies, low diabetes supplies, post-surgery... The shopper picks the approved items and its store links are shown under the reply. Nothing is bought: the user checks out themselves. Skipped for emergencies.
- **Symptom analyzer:** only with the user's OK. If they want to know what's causing their symptoms, the model offers the CREAO analysis; `analyze_symptoms` is only given to the model once they ask for it outright or say yes (offer lasts 30 minutes).
- **Regular:** everything else goes to the assistant as before. If Jev is down, everything takes this path.

## CREAO symptom analysis
**Agent:** Symptom & Biosensor Health Analyzer, agent ID `4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`, built on agent.creao.ai (bundle in `creao/`).
**Try the agent:** https://agent.creao.ai/install/4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c?version=44a07c43-9e4d-450f-9265-1862ba775e56

Once the user OKs it (see Routing), the core model calls `analyze_symptoms`. That starts a CREAO run in the background through the API Trigger, and the report (1-3 ranked conditions, red flags, care guidance, disclaimer) arrives a few minutes later as its own message, in the app or on Telegram.
- **Finishing:** CREAO calls `/creao` on the Convex site when the run ends. The webhook URL carries `CREAO_WEBHOOK_SECRET`, and the result is always re-fetched from CREAO rather than trusted from the webhook body. Polling every minute (up to ~20 minutes) covers missed webhooks and local deployments, which CREAO can't call back.
- **Limits:** one analysis at a time per user and 3 a day, since every run spends CREAO credits.
- **Privacy:** the symptoms and any health data the user shared are sent to CREAO. The model is told to say so when it starts a run.

## Health Supply Shopper
Finds over-the-counter health supplies: picks the cheapest approved items that follow the user's rules, then sends Amazon and Walmart links for each one plus a one-tap link per store that fills the user's own cart. We never buy or pay; the user checks out. Runs inside Convex (`convex/shop.ts`, logic in `convex/lib/shopping/`); try it directly with `npx convex run shop:chat '{"text": "restock my period kit today"}'`.

| Kit | Example | Items (priority order) |
|---|---|---|
| Diabetes care | "My sensor is almost out, restock my diabetes kit" | Dexcom Stelo OTC CGM, Dex4 glucose gel, alcohol prep pads, lancets, sensor overpatches |
| Allergy and air quality | "AQI is bad, restock my allergy kit today" | Loratadine 10 mg, NeilMed saline spray, HEPA filter, inhaler spacer |
| Post-surgery recovery | "Day 3 after knee surgery, need wound supplies" | Telfa pads, paper tape, cold pack, Voltaren gel, TheraBand |
| Period care | "Cramps are starting, get my period kit today" | ThermaCare heat wraps, Advil, magnesium glycinate, dark chocolate |
| Headache relief | "I have a pounding headache, get me something" | Acetaminophen 500 mg, Liquid I.V., Be Koool cooling sheets |

**How it works**
1. **Reads the request with Snowflake Cortex** (`lib/shopping/understanding.ts`): kit, items, urgency (within 2 hours / today / 3 days), budget, place. Keyword rules take over if the model is down. The model can only read: the safety rules re-run on the user's exact words, and it can't add products or raise a budget.
2. **Checks live air quality** (Open-Meteo) for allergy orders. At US AQI 101+, the HEPA filter can't be dropped and delivery moves up to today.
3. **Builds the cheapest valid kit** at catalog list prices. Over budget: optional items are dropped from the bottom of the list.
4. **Finds each item at Amazon and Walmart** (`lib/shopping/links.ts`) with Jina web search, limited to each store's site. Only a product page whose title matches the approved product (brand or ingredient, and strength) counts; no store page is loaded or scraped.
5. **Sends the links**: one per item per store (a store search link if no match was found), plus one-tap cart links (Amazon `gp/aws/cart/add.html`, Walmart `affil.walmart.com/cart/addToCart`) that put every found item in the user's own cart.

**Safety rules (in code):** no prescription items (and no OTC swap for one you asked for); never over the stated budget or the profile's cap for that kit; no substitutions (only the exact SKU, brand, or ingredient + strength in the profile); nothing is ever bought for the user; emergencies get a call-911 reply and no order.

**Simulated:** only the demo user's profile (`lib/shopping/data.ts`).

## Telegram setup
1. `@BotFather` → `/newbot` → token.
2. Register the webhook (needs a public Convex deployment, not local):
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<app>.convex.site/telegram&secret_token=$SECRET"
   ```
