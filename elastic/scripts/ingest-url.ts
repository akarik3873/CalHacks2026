// Fetches a web page or PDF with Jina Reader and saves it to the research index.
// Usage: npm run elastic:ingest-url -- <url> [search query it answers]

import { env, es } from "./lib.js";

const [url, query] = process.argv.slice(2);
if (!url) {
  console.error("Usage: npm run elastic:ingest-url -- <url> [query]");
  process.exit(1);
}

const res = await fetch(`https://r.jina.ai/${url}`, {
  headers: { Authorization: `Bearer ${env("JINA_API_KEY")}`, Accept: "application/json" },
});
if (!res.ok) throw new Error(`Jina Reader failed with ${res.status}: ${await res.text()}`);
const { data } = (await res.json()) as { data: { title: string; content: string; url: string } };

const id = Buffer.from(data.url ?? url).toString("base64url").slice(0, 200);
await es("PUT", `/research/_doc/${id}?refresh=wait_for`, {
  body: { url: data.url ?? url, title: data.title, content: data.content, query, fetched_at: new Date().toISOString() },
});
console.log(`Saved "${data.title}" (${data.content.length} chars) to research`);
