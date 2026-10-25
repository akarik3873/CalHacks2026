# Wellnest — AI health assistant (CalHacks2026)

Chat in the app (web + iOS + Android, Expo) or text the Telegram bot, by typing or by voice. See `plan2.md`.

## Layout
- `App.tsx`, `src/` — Expo app: sign-in, chat, settings (voice mode, "Text me on Telegram").
  - `useVoice.ts` — voice mode: mic → Cartesia STT → send; replies → Cartesia TTS. `speaker.web.ts` / `speaker.ts` — streaming playback on web / iOS + Android (see Voice below).
- `convex/` — backend.
  - `pipeline.ts` — shared pipeline: Jina embed → vector search memory → Cortex triage → Cortex core model + tools → reply.
  - `chat.ts` — app API. `telegram.ts` + `http.ts` — Telegram webhook, account linking and voice notes.
  - `voice.ts` — Cartesia tokens for the app, and `/tts` (a streamed MP3 of a reply, for iOS/Android).
  - `lib/` — Cortex, Jina, Telegram, Cartesia (`cartesia.ts`) clients, `speech.ts` (Markdown → speakable text), and model tools (`web_search`, `read_page`, `bio_research`).
  - `creao.ts` + `lib/creao.ts` — detailed symptom analysis by the CREAO agent (see below).
  - `shop.ts` + `lib/shopping/` — Health Supply Shopper: Amazon and Walmart links for OTC health supplies (see below).
  - `lib/jev.ts` — routes each message: shopping, symptom analyzer, or regular.
- `creao/` — the CREAO agent bundle: `SKILL.md` (its program), `config.yaml` (form fields, memory), `README.md`.

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
| `CARTESIA_API_KEY` | voice (app voice mode and Telegram voice notes); optional `CARTESIA_VOICE_ID` (default: the Sonic voice `db6b0ed5-…`) |
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

## Voice (Cartesia)
Voice works everywhere the assistant does. In the app, voice mode is on by default (turn it off in **Settings**): tap the mic, speak, tap the red stop button, and the reply is read aloud as it streams in. On Telegram, just send a voice note: the bot answers in text and with a voice note.

**Cartesia features used**
| Feature | Where | How |
|---|---|---|
| **Sonic TTS over WebSocket** (`sonic-3.6`, raw `pcm_f32le`, 44.1 kHz) | Web app | `src/speaker.web.ts` keeps one WebSocket open and plays each audio chunk as it arrives (Web Audio, scheduled back to back), so speech starts after the first chunk instead of after the whole reply. The next reply is generated while the current one plays; **Stop** cancels the context at Cartesia. |
| **Sonic TTS, streamed bytes** (`/tts/bytes`, MP3) | iOS/Android app, Telegram | The app plays `GET /tts?message=<id>`, which Convex streams straight from Cartesia, so playback starts early. Telegram gets the MP3 as a voice note (`sendVoice`). |
| **Batch STT** (`ink-whisper`) | App mic, Telegram voice notes | The app sends its recording (WebM, MP4 or M4A); Convex sends Telegram's Ogg/Opus voice notes. |
| **Access tokens** (`/access-token`, STT + TTS grants, 5 minutes) | App | `voice.token` mints one for a signed-in user, so the API key never ships in the app. |

**How a voice turn works**
1. **In:** the app records with `expo-audio` and calls Cartesia STT with a short-lived token. A Telegram voice note is downloaded by Convex (`getFile`) and transcribed with the server key.
2. **Same pipeline:** the transcript runs through routing, memory, shopping and the model exactly like typed text.
3. **Out:** `convex/lib/speech.ts` turns the Markdown reply into speakable text (no URLs, symbols or "Sources:" lists; long replies stop at a sentence and say the rest is in the text). Store links are shown but never read aloud.

**Safety, privacy and accessibility**
- The Cartesia API key stays in Convex. The app only gets 5-minute tokens, and `/tts` only speaks the signed-in user's own replies.
- Audio isn't stored: recordings and voice notes are sent to Cartesia for transcription and only the text is kept, like a typed message. The Telegram reply quotes what was heard, so a mistranscription is easy to spot.
- Voice notes over 3 minutes, or past the daily message limit, are turned away before any audio is downloaded or sent to Cartesia.
- The Mic button shows every step (waiting for permission, listening, transcribing, speaking), announced to screen readers on web and Android, explains blocked or missing microphones (with Open Settings on iOS/Android), and stops itself after 2 minutes. Spoken replies can be stopped at any time, and turning voice mode off stops both recording and speech.
- Speech is optional: if Cartesia fails, the text reply is always there.

**Setup**
1. Create a key at [play.cartesia.ai](https://play.cartesia.ai) and run `npx convex env set CARTESIA_API_KEY sk_car_...` (optionally `CARTESIA_VOICE_ID`).
2. Web: open the app over https (or localhost) and sign in; voice mode is on by default. The browser asks for the microphone on the first tap of the mic button.
3. iOS/Android: voice needs a development build (`npx expo run:ios` / `npx expo run:android`); Expo Go can't record.
4. Telegram: nothing extra; voice notes work once the bot's webhook is set (see below).

**Known limitations**
- STT is batch, not real-time: the transcript comes after you tap Stop, not while you speak, and there's no voice barge-in (tap Stop instead).
- English only (`language: "en"` for STT and TTS).
- On iOS/Android, replies stream as MP3 through Convex (one extra hop) rather than over the WebSocket, because the app can't play raw PCM there. Voice on a real phone still needs testing.
- Web browsers only allow sound after a tap on the page; tapping Send or Mic unlocks it.
- Spoken replies are capped at about 2,500 characters (about 3 minutes of speech).

## Telegram setup
1. `@BotFather` → `/newbot` → token.
2. Register the webhook (needs a public Convex deployment, not local):
   ```bash
   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<app>.convex.site/telegram&secret_token=$SECRET"
   ```
