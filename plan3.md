# Plan 3: Elastic focus

Same product as [plan2.md](plan2.md): an AI health assistant you use in the app or by texting it on Messenger. What changes: **Elasticsearch becomes the brain for the user's health data**, and the project is built to win **Find the Signal: Best Use of Elasticsearch** (see [sponsor-tracks.md](sponsor-tracks.md#find-the-signal-best-use-of-elasticsearch)).

The track is about turning messy data into insights, answers, or actions. Health data is a good fit because it's messy: free-text symptom messages, lab PDFs, med lists, sleep and heart-rate exports, visit notes. The pitch is one sentence:

> **It finds the signal in your health data that you and a 10-minute doctor's visit would miss, shows its work, and tells you before you ask.**

## What the Elastic judges score, and how we hit each one
| Criterion | What we build |
|---|---|
| Depth and creativity of the Elasticsearch implementation | 3 indices, hybrid search (BM25 + semantic + rerank in one `retriever`), ES\|QL for trends over time, per-user document-level security |
| Jina models for embeddings | `semantic_text` fields backed by Jina embeddings through the Elastic Inference Service, plus a Jina reranker. Jina Reader for pulling in web pages and PDFs |
| Elastic Agent Builder and Workflows | The core agent lives in Agent Builder, with our own ES\|QL and search tools. Workflows run the daily "signal check" and the red-flag alert, and push results to Messenger |
| Elastic Cloud Serverless | Everything runs on one Serverless Search project from https://ela.st/calhacks |

## What changes from plan 2
| Part | Plan 2 | Plan 3 |
|---|---|---|
| Memory and search | Convex vector index | Elasticsearch on Elastic Cloud Serverless |
| Embeddings | Jina API called from Convex | Jina via Elastic Inference Service (`semantic_text`), so ES embeds on ingest |
| Reranking | none | Jina reranker in the search `retriever` |
| Core agent | Cortex model with tools, looped in Convex | Elastic Agent Builder agent, called from Convex |
| Trends over time | none | ES\|QL tools the agent calls |
| Proactive messages | none | Elastic Workflows (scheduled + alert) → Convex → Messenger |
| Cortex | core model | triage only, and fallback chat if Agent Builder is down |
| Convex | everything backend | app backend: users, settings, live chat, webhooks, agents table. No longer stores vectors |

Convex stays because it's still the simplest live backend for the Expo app and the Messenger webhook, and it keeps us eligible for the Convex track.

## Stack
| Part | Tool |
|---|---|
| App (web + iOS + Android) | React Native with Expo |
| App backend | Convex (live chat, settings, HTTP actions for Messenger and Workflow callbacks) |
| Health data store and search | Elasticsearch, Elastic Cloud Serverless (Search project) |
| Embeddings | Jina embeddings via Elastic Inference Service, on `semantic_text` fields |
| Reranking | Jina reranker via `text_similarity_reranker` retriever |
| Core agent | Elastic Agent Builder (custom agent + custom tools) |
| Automation | Elastic Workflows |
| Triage model | Snowflake Cortex (small model) |
| Web research | Jina Search + Reader, results cached into the `research` index |
| Voice | Cartesia (STT in, TTS out) |
| Texting | Facebook Messenger |

## Architecture

```
 Expo app ─┐                         ┌──────────── Elastic Cloud Serverless ─────────────┐
 Messenger ┼─► Convex ──(1) write ──►│  health-timeline   health-docs   research         │
 Voice ────┘    │                    │        ▲ semantic_text (Jina) on ingest          │
                │                    │                                                   │
                ├──(2) triage (Cortex)                                                   │
                │                    │                                                   │
                └──(3) converse ────►│  Agent Builder: "Signal" agent                    │
                   ◄── answer +      │    tools: hybrid search, ES|QL trend tools,       │
                       tool trace    │           web_research, schedule_checkin          │
                                     │                                                   │
   Messenger ◄── Convex HTTP ◄───────│  Workflows: daily-signal-check, red-flag-alert    │
                                     └───────────────────────────────────────────────────┘
```

### How a message flows
1. User sends a message (app, voice, or Messenger). Convex saves it to the chat and writes it to `health-timeline` as `kind: message`. ES embeds it on ingest with Jina.
2. Cortex triages: is it medical, is it urgent? Urgent red flags (chest pain, stroke signs, suicidal language) skip the agent and get a fixed safety reply right away.
3. Convex calls the Agent Builder converse API with the user's scoped API key. The agent picks tools, runs them, and answers with citations.
4. Convex shows the answer and the tool trace in the app (which tools ran, the ES|QL it wrote, which docs it cited). Same reply goes to Messenger. If voice is on, Cartesia speaks it.

## Elasticsearch design

### Indices
| Index | What's in it | Key fields |
|---|---|---|
| `health-timeline` | Every dated event: symptoms, meds started/stopped, vitals, sleep, chat messages, lab values | `@timestamp`, `user_id`, `kind`, `name`, `value`, `unit`, `text` (`text` + `semantic_text`), `source` |
| `health-docs` | Chunked lab reports, visit notes, discharge papers (PDFs) | `user_id`, `doc_id`, `title`, `page`, `content` (`semantic_text`), `doc_date` |
| `research` | Web pages and papers the agent looked up, cached and shared across users | `url`, `title`, `content` (`semantic_text`), `fetched_at` |

Lab PDFs are parsed with Jina Reader. Extracted lab values (ferritin, A1C, TSH, and so on) go into `health-timeline` as `kind: lab` so ES|QL can trend them. The full text goes into `health-docs` for search.

### Search
One hybrid `retriever` for every "find me related stuff" call:
- `rrf` combining a BM25 `multi_match` (catches exact drug names and lab codes) and a `semantic` query on the `semantic_text` field (catches "wiped out" ≈ "fatigue").
- Wrapped in a `text_similarity_reranker` using the Jina reranker for the top results.
- Always filtered by `user_id` (enforced by the API key, see Safety).

### ES|QL tools (the "signal" part)
These are registered as custom tools in Agent Builder, each with a fixed ES|QL query and typed parameters:

| Tool | What it answers |
|---|---|
| `symptom_trend(symptom, weeks)` | How often a symptom shows up per week, before vs. after a date |
| `med_timeline()` | Every med with start and stop dates |
| `lab_history(test)` | All values for a lab test with reference range and out-of-range flags |
| `before_after(event, metric)` | A metric (sleep hours, resting HR, a symptom count) in the N weeks before and after an event like starting a med |
| `recent_changes(days)` | Anything that moved the most in the last N days |

Plus Agent Builder's built-in index search tools over `health-docs` and `research`, and two more:
- `web_research(query)`: Jina Search + Reader, writes results to `research`, then searches them. Exposed as a Workflow tool if Agent Builder supports it on Serverless, otherwise a small Convex HTTP endpoint behind an MCP-style tool.
- `schedule_checkin(topic, days)`: runs a Workflow that messages the user later ("How's the headache since you cut back on caffeine?").

### Agent Builder agent: "Signal"
- Instructions: never diagnose; always cite the timeline entries or doc chunks used; say what it doesn't know; suggest what to ask a doctor; escalate red flags.
- Tools: the ES|QL tools above, hybrid search on `health-docs` and `research`, `web_research`, `schedule_checkin`.
- Model: the default Elastic-managed LLM to start. Swap through a connector later only if quality is a problem.
- We test and tune it in Kibana's Agent Builder chat first, then call it from Convex.

### Workflows
| Workflow | Trigger | Steps |
|---|---|---|
| `daily-signal-check` | Schedule, every morning | For each user: run `recent_changes` and `before_after` checks → if something crosses a threshold, ask the Signal agent to write a 2-sentence heads-up → HTTP POST to a Convex HTTP action → Messenger + app notification |
| `red-flag-alert` | Alert rule on new `health-timeline` docs matching red-flag terms | Send the fixed safety message right away, log it, mark the user for follow-up |
| `checkin` | Called by the `schedule_checkin` tool | Wait N days → send the check-in message via Convex |

All Workflow YAML lives in the repo under `elastic/workflows/` so judges can read it.

## Safety and privacy
- **Demo data is synthetic.** No real health data. One seeded persona with about 6 months of data.
- **Per-user scoped keys.** Convex creates a restricted API key per user with document-level security (`user_id` must match) and read-only access to that user's data. The converse call runs with that key, so every agent tool is scoped to one user even if the model tries otherwise. (Check that DLS in API key role descriptors works on Serverless on day 1. Fallback: every tool takes `user_id` from a Convex-injected parameter, not the model.)
- The admin key lives only in Convex env vars and is never sent to the app.
- Red flags get a fixed reply, not a model-generated one.
- Every answer shows its sources and the tool trace, so the user can check it.

## The demo moment (open with this)
Seeded persona "Maya": started omeprazole in July, mentions being tired more and more often in Messenger, uploaded a September lab PDF she never read closely.

1. Maya asks: "Why have I been so tired lately?"
2. On screen, the agent's trace: `symptom_trend("fatigue")` shows mentions up about 3x since August; `med_timeline()` shows omeprazole started in July; `lab_history("ferritin")` finds 12 ng/mL (low) in the September PDF; `web_research` pulls a source on acid reducers and iron absorption.
3. Answer: "Your tiredness started rising about 5 weeks after omeprazole, and your September ferritin was low. Those can be related. Ask your doctor about your iron levels and whether the omeprazole is still needed." With links to each entry and the PDF page.
4. Then show Messenger: the `daily-signal-check` Workflow already flagged this to her yesterday, before she asked.

That's insight (the pattern), answer (the explanation with sources), and action (the proactive message and check-in): the three words in the track description.

## Repo layout for the Elastic parts
```
elastic/
  mappings/         index mappings + inference endpoint setup
  esql/             the ES|QL behind each tool
  agent/            Agent Builder agent + tool definitions (JSON)
  workflows/        Workflow YAML
  seed/             synthetic persona generator + bulk loader
```
The README gets a "How we use Elastic" section that maps each judging criterion to a file.

## Build order
Elastic first, so the submission is safe even if the rest slips.

1. **Setup (first hour):** create the Serverless project from https://ela.st/calhacks. At the Elastic booth, confirm Agent Builder, Workflows, and the Jina inference endpoints are on for it.
2. **Data:** mappings, inference endpoints, synthetic Maya generator, bulk load. Check the semantic search works in Dev Tools.
3. **Search + ES|QL:** hybrid retriever with rerank; write and test each ES|QL tool query.
4. **Agent Builder:** create the Signal agent and tools; get the demo question working in Kibana's chat.
5. **App:** Expo + Convex chat that calls the converse API and shows the tool trace.
6. **Ingest from the app:** messages → timeline; PDF upload → Jina Reader → docs + lab values.
7. **Workflows:** `daily-signal-check` and `red-flag-alert` → Convex HTTP action.
8. **Messenger** webhook (send and receive).
9. **Cartesia** voice toggle.
10. **Stretch:** `checkin` Workflow, `call_external_agent` (Fetch, Creao) from plan 2.

**Cut line:** steps 1–7 are the Elastic submission. If we're behind at the halfway point, drop 9 and 10.

## Other tracks this still fits
| Track | Why | Effort beyond the plan |
|---|---|---|
| Elastic (primary) | everything above | none |
| Convex | live app backend, webhooks, Workflow callbacks | write up how Convex is used |
| Cartesia | voice mode | step 9 |
| Microsoft (healthcare agent) | production-minded agent in healthcare; scoped keys and red-flag handling help on "responsible design" | write-up only |

## Open questions for the Elastic booth
- Are Agent Builder and Workflows both available on the hackathon Serverless projects, and are there quotas?
- Which Jina models are on the Elastic Inference Service for us (embeddings v3 or v4, reranker version)?
- Can a Workflow step call the Agent Builder agent directly, and can a Workflow be exposed as an Agent Builder tool?
- Does the converse API return the tool-call trace we want to show in the app?

## Keys needed
`ELASTICSEARCH_URL`, `KIBANA_URL`, `ELASTIC_API_KEY` (admin, Convex env only), `SNOWFLAKE_*`, `JINA_API_KEY` (Search + Reader), `CARTESIA_API_KEY`, `MESSENGER_PAGE_TOKEN`, `MESSENGER_VERIFY_TOKEN`, `MESSENGER_APP_SECRET`
