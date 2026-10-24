// Jina: embeddings, web search (s.jina.ai) and page reader (r.jina.ai).
import { env } from "./env";
import { EMBEDDING_DIMS } from "../schema";

const headers = () => ({
  Authorization: `Bearer ${env("JINA_API_KEY")}`,
  Accept: "application/json",
});

// "text-matching" is symmetric, so one embedding serves both storing and searching.
export async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      task: "text-matching",
      dimensions: EMBEDDING_DIMS,
      input: [text],
    }),
  });
  if (!res.ok) throw new Error(`Jina embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export type SearchResult = { title: string; url: string; content: string };

export async function search(query: string, site?: string): Promise<SearchResult[]> {
  const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
    headers: {
      ...headers(),
      "X-Respond-With": "no-content",
      ...(site ? { "X-Site": site } : {}),
    },
  });
  if (!res.ok) throw new Error(`Jina search ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.data ?? []).slice(0, 5).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: (r.description ?? r.content ?? "").slice(0, 500),
  }));
}

export async function read(url: string, maxChars = 6000): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Authorization: `Bearer ${env("JINA_API_KEY")}`, "X-Return-Format": "text" },
  });
  if (!res.ok) throw new Error(`Jina read ${res.status}: ${await res.text()}`);
  return (await res.text()).slice(0, maxChars);
}
