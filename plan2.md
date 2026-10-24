# Plan 2

AI health assistant. Use it in the app (web + mobile) or just text it on Messenger.

## Stack
| Part | Tool |
|---|---|
| App (web + iOS + Android) | React Native with Expo (one codebase) |
| Backend + DB | Convex (JS functions, HTTP actions for webhooks) |
| LLM | Snowflake Cortex REST API (key coming) |
| Embeddings | Jina |
| Vector search | Convex vector index |
| Web search / bio research | Jina Search + Reader APIs, called as tools by the core model |
| Voice | Cartesia (STT in, TTS out) |
| Texting | Facebook Messenger |
| Domain (later) | GoDaddy |

## How it works
1. User sends a message (app, voice, or Messenger).
2. Convex saves it, embeds it with Jina, and pulls related past data (vector search).
3. A small Cortex model triages it: is this medical? urgent?
4. The core model answers. If it needs info, it calls tools:
   - `web_search` / `read_page` (Jina)
   - `bio_research` (search + summarize papers/sources)
   - `call_external_agent` (Creao, Fetch)
5. Reply goes back to the same channel. If voice is on, Cartesia speaks it.

## Texting: Messenger
- Easier than SMS. US SMS (Twilio) needs A2P 10DLC registration, which takes days to weeks.
- Messenger: make a FB Page + Meta app, point the webhook at a Convex HTTP action. Dev mode works for you and testers without app review.
- Backup: Telegram bot (even easier, one token).

## Voice: Cartesia
- Only runs if the user turns on "Voice mode" in settings (stored in Convex).
- In: mic audio → Cartesia STT → text → same pipeline.
- Out: reply text → Cartesia TTS (Sonic) → play in the app.
- Convex issues short-lived Cartesia tokens so the API key never ships in the app.

## Embeddings: answers
- **Does Convex store embeddings?** Yes. It has built-in vector indexes (up to 4096 dims). Jina vectors fit fine.
- **Does Elasticsearch store embeddings?** Yes, with `dense_vector` fields, and it works natively with Jina (Elastic owns Jina now).
- **Pick:** use Convex only for now. Add Elasticsearch later only if you go for the Elastic/Jina prize or need hybrid (keyword + vector) search.

## External agents (Creao, Fetch)
Don't build them. Just call agents other people made.

**MCP or not?**
- **Not for v1.** These agents are reached over HTTP (Creao webhooks/requests, Fetch Agentverse). One plain tool, `call_external_agent(agent, input)`, is simpler.
- Use MCP later if you want any MCP-capable model or client to plug into them too. The same tool can be wrapped as an MCP server with no rewrite.

**How agents call agents outside their scope:**
- Every agent has an address (a URL, webhook, or agent ID) and a message format it accepts.
- Your agent sends a request to that address, then gets the answer back in the response or later through a callback webhook.
- Fetch: agents have addresses on Agentverse and talk through its chat protocol, or over REST via Agentverse.
- Creao: hit their webhook/endpoint with a request and wait for the result.
- Keep a small `agents` table in Convex: name, endpoint, auth, what it's for. The core model picks one from this list.

## Not doing now
- Apify (the core model does search through Jina for now)
- Shopping (Fetch/Visa)
- Commit Fellowship, Microsoft
- Deploying (GoDaddy domain later)

## Build order
1. Expo app + Convex setup, chat screen.
2. Cortex chat (once the Snowflake key arrives).
3. Jina embeddings + Convex vector search for memory.
4. Web search + bio research tools.
5. Messenger webhook.
6. Cartesia voice toggle.
7. `call_external_agent` + `agents` table (Creao, Fetch).

## Keys needed
`SNOWFLAKE_*`, `JINA_API_KEY`, `CARTESIA_API_KEY`, `MESSENGER_PAGE_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_APP_SECRET`
