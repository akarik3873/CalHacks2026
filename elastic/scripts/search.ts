// Hybrid search: BM25 + semantic (Jina embeddings), fused with RRF, then reranked by the Jina reranker.
// Usage: npm run elastic:search -- "always tired" [health-docs|health-timeline|research]

import { type IndexName, es, inferenceIds } from "./lib.js";

const FIELDS: Record<IndexName, { text: string[]; semantic: string; rerank: string; show: string[] }> = {
  "health-timeline": { text: ["text"], semantic: "text_semantic", rerank: "text", show: ["@timestamp", "kind", "name", "text"] },
  "health-docs": { text: ["title^2", "content"], semantic: "content_semantic", rerank: "content", show: ["doc_date", "doc_type", "title"] },
  research: { text: ["title^2", "content"], semantic: "content_semantic", rerank: "content", show: ["title", "url"] },
};

export function hybridQuery(index: IndexName, query: string, size = 5) {
  const fields = FIELDS[index];
  return {
    size,
    _source: fields.show,
    retriever: {
      text_similarity_reranker: {
        retriever: {
          rrf: {
            retrievers: [
              { standard: { query: { multi_match: { query, fields: fields.text } } } },
              { standard: { query: { semantic: { field: fields.semantic, query } } } },
            ],
          },
        },
        field: fields.rerank,
        inference_id: inferenceIds().rerank,
        inference_text: query,
        rank_window_size: 20,
      },
    },
  };
}

const [query, index = "health-docs"] = process.argv.slice(2);
if (!query) {
  console.error('Usage: npm run elastic:search -- "your query" [health-docs|health-timeline|research]');
  process.exit(1);
}
if (!(index in FIELDS)) throw new Error(`Unknown index ${index}`);

const result = await es("POST", `/${index}/_search`, { body: hybridQuery(index as IndexName, query) });
for (const hit of result.hits.hits) {
  console.log(`${hit._score.toFixed(3)}  ${JSON.stringify(hit._source)}`);
}
