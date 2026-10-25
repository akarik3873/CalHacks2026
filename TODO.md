# TODO / Status

_Last updated: 2026-10-25_

## Status
- **Convex:** cloud dev deployment `merry-capybara-181` (team abraham-karikkineth, project calhacks-health).
  - API: `https://merry-capybara-181.convex.cloud`, HTTP/webhooks: `https://merry-capybara-181.convex.site`.
  - Run `npx convex dev` while coding to push changes. Dashboard: `npx convex dashboard`.
  - The old local backend (`.convex/local/`) is stopped and no longer used.
- **Keys set on the cloud deployment** (Convex env, not in files): Snowflake PAT + account URL, Jina, Cartesia, Elasticsearch, Telegram webhook secret + bot token + username, Convex Auth keys.
- **Verified on cloud:** sign-up, sending a message, Jina embeddings stored, webhook rejects requests without the secret.
- **Working + tested:** Jina (embeddings, search, reader), Cartesia (voice tokens), Elasticsearch (connects; not used yet).
- **Snowflake Cortex:** unblocked (2026-10-24), `openai-gpt-5.4` answers.
- **Tests:** `npm test` (99 backend tests; outside APIs are faked).

## You
1. ~~Convex cloud~~ (done).
2. ~~Snowflake network policy~~ (done).
3. ~~Telegram bot~~ (done: `@calhacks2026_bot`, token + username set, webhook registered).
4. **CREAO share link:** agent install link added to README. If the track needs a link to a *run* specifically, share run `fb809934-b392-4fa0-a294-a38531bb5ca6` on agent.creao.ai and add it too.
5. ~~Real Telegram test~~ (done: works from a real phone).
5b. **Optional cleanup:** the Cloud Run service is deleted; the GCP project `calhacks-browser-7f46a1` and its `browser-api-key` secret are still there.
6. **Delete the empty `CalHacks2026` Convex project** in the dashboard (duplicate of calhacks-health).

## Next (after the above)
6. ~~Telegram webhook~~ (done).
7. Test end to end in the app: AI replies, linking (Yes/No step), voice on web. (Telegram webhook path, Jev routing, shopper and CREAO verified on cloud 2026-10-24.)
7a. Click the Walmart one-tap cart link in a real browser once to check it adds every item (Amazon's format is well known; Walmart's is not documented).
7b. Commit the current work (nothing committed since the merges).
7c. ~~Shopper raising urgency on "pounding headache"~~ (fixed by switching the shopper model to `claude-haiku-4-5`).
8. Test voice on a real phone (needs a development build, not Expo Go).
9. Optional: move the core model up with `npx convex env set CORTEX_CORE_MODEL openai-gpt-6.1-sol` (default is `openai-gpt-5.4`).

## Bugs (known, not fixed)
- None open.

## Later
- Google sign-in.
- Decide on the `elastic` branch (separate Signal agent + its own Expo app; not merged).
- Elasticsearch for memory (keyword + vector search; Elastic/Jina prize).
- From `plan2.md`: Creao / Fetch agents, Apify, shopping, GoDaddy domain, deploying.
- Rotate the keys that were pasted in chat.
- Raw error text in the app: server errors are shown word for word (e.g. the Telegram button before the bot exists). Fix: user-facing errors from the server + a friendly fallback in the app.

## Done
- Web app live at https://merry-capybara-181.convex.site (Convex static hosting; `npm run deploy:web`).
- Expo app (web + iOS + Android): sign-in, chat, settings (voice mode, location, Telegram link).
- Pipeline: Jina embeddings + vector memory (skips the recent chat window), Cortex triage + core model with tools (`web_search`, `read_page`, `bio_research`, `save_location`).
- Telegram: webhook (fails closed without the secret), auto accounts, Yes/No link confirmation, formatting, typing indicator, location pins.
- 100 messages per user per rolling 24h (app + Telegram combined).
- Jev routing (`convex/lib/jev.ts`): proactive shopping with approval, analyzer only after the user's OK.
- Shopper sends store links (2026-10-25): Amazon + Walmart links per item and one-tap cart links, found with Jina search. The Cloud Run browser service (`browser/`), the approval step and `BROWSER_URL`/`BROWSER_API_KEY` are removed (every store blocked Cloud Run IPs). Legacy `carts` table kept.
- Shopper was real stores only (2026-10-24): the simulated merchants and simulated card payments are removed. Amazon first, Target/Walgreens/CVS as fallbacks; store down = friendly error, no cart. Legacy tables `cardAuths` + `shopOrders` kept (dev still has rows; nothing writes them).
- Shopper ported from Python (Fetch.ai) to TypeScript in Convex (`convex/shop.ts`, `convex/lib/shopping/`), Snowflake reads requests; headache kit added. `agents/` removed (no ASI:One/Fetch.ai prize).
- Merged `fetch-shopping-agent` and `creao-symptom-analyzer` (creao/, `analyze_symptoms` tool, `/creao` webhook).
- Cartesia voice (short-lived tokens, STT in, TTS out).
- Mic button fixed (2026-10-25): shows "Waiting for microphone permission…", "Listening…" and "Transcribing…"; blocked, missing or busy mics get a clear message (Open Settings on native); double taps ignored; recordings stop at 2 minutes or when voice mode is turned off.
- Daily cleanup of expired link codes; sign-up error messages.
