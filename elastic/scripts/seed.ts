// Loads the synthetic Maya persona into Elastic. Dates are relative to today, so re-seed on demo day.
// Usage: npm run elastic:seed           (replaces Maya's docs)
//        npm run elastic:seed:dry       (writes elastic/seed/out/maya.ndjson and prints a summary, no Elastic needed)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { USER_ID, generateMaya } from "../seed/maya.js";
import { ELASTIC_DIR, INDICES, es } from "./lib.js";

const BATCH = 100;
const docs = generateMaya();

if (process.argv.includes("--dry-run")) {
  const outDir = path.join(ELASTIC_DIR, "seed", "out");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "maya.ndjson"), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");

  const counts = new Map<string, number>();
  for (const { index, doc } of docs) {
    const key = `${index} ${doc.kind ?? doc.doc_type}${doc.kind === "symptom" || doc.kind === "lab" ? `:${doc.name}` : ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...counts].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
  console.log(`\n${docs.length} docs written to elastic/seed/out/maya.ndjson`);
  process.exit(0);
}

for (const index of INDICES.filter((i) => i !== "research")) {
  await es("POST", `/${index}/_delete_by_query?refresh=true`, { body: { query: { term: { user_id: USER_ID } } } });
}

for (let i = 0; i < docs.length; i += BATCH) {
  const ndjson = docs
    .slice(i, i + BATCH)
    .flatMap(({ index, id, doc }) => [JSON.stringify({ index: { _index: index, _id: id } }), JSON.stringify(doc)])
    .join("\n");
  const result = await es("POST", "/_bulk", { ndjson: ndjson + "\n" });
  if (result.errors) {
    const failed = result.items.filter((item: any) => item.index?.error);
    throw new Error(`Bulk had ${failed.length} errors, first: ${JSON.stringify(failed[0].index.error)}`);
  }
  console.log(`indexed ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
}

await es("POST", `/${INDICES.join(",")}/_refresh`);
console.log(`\nSeeded ${docs.length} docs for ${USER_ID}. Try: npm run elastic:ask -- "Why have I been so tired lately?"`);
