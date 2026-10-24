# Elastic

Everything Signal does with Elastic: where the health data lives, how it's searched, and the agent that reasons over it. Architecture is in [plan3.md](../plan3.md).

| Folder | What's in it |
|---|---|
| `mappings/` | The three indices. `text` and `content` are copied into `semantic_text` fields embedded with Jina |
| `inference/` | Jina embeddings (`jina-embeddings-v3`) and reranker (`jina-reranker-v2-base-multilingual`) endpoints |
| `agent/tools/` | Agent Builder tools: six ES\|QL tools that find trends, three index search tools |
| `agent/signal.json` | The Signal agent: instructions and which tools it can use |
| `seed/maya.ts` | Synthetic demo persona with a planted signal (fatigue rising after a med change, low iron in a lab report) |
| `scripts/` | Setup, seeding, and CLIs for testing search and the agent |

## Setup
1. Create an Elastic Cloud Serverless **Search** project at https://ela.st/calhacks. Create an API key in it.
2. Get a Jina API key at https://jina.ai/api-dashboard.
3. Copy `.env.example` to `.env` at the repo root and fill in `ELASTICSEARCH_URL`, `KIBANA_URL`, `ELASTIC_API_KEY`, `JINA_API_KEY`.
4. Run, from the repo root:

```bash
npm install
npm run elastic:setup
npm run elastic:seed
npm run elastic:ask -- "Why have I been so tired lately?"
```

`elastic:setup` is safe to re-run. `npm run elastic:reset` recreates the indices, which deletes their data.

## Testing pieces on their own
- `npm run elastic:seed:dry`: generates the persona to `seed/out/maya.ndjson` without touching Elastic.
- `npm run elastic:search -- "wiped out" health-timeline`: hybrid search (BM25 + semantic, RRF, Jina rerank).
- `npm run elastic:ingest-url -- <url>`: pulls a page through Jina Reader into the `research` index.

## Connecting the app
The Convex action `convex/signal.ts` calls the agent. Set `KIBANA_URL` and `ELASTIC_API_KEY` as Convex environment variables:

```bash
npx convex env set KIBANA_URL https://<project>.kb.<region>.elastic.cloud
```

```bash
npx convex env set ELASTIC_API_KEY <key>
```

## Not done yet
- Workflows (`daily-signal-check`, `red-flag-alert`) and the `web_research` / `schedule_checkin` tools
- Per-user API keys with document-level security (one demo user for now)
- Using Elastic-hosted Jina endpoints instead of our own key: set `ELASTIC_EMBEDDING_INFERENCE_ID` / `ELASTIC_RERANK_INFERENCE_ID` once we know their IDs
