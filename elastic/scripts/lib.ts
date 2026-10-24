import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ELASTIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const INDICES = ["health-timeline", "health-docs", "research"] as const;
export type IndexName = (typeof INDICES)[number];

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

/** Inference endpoint IDs, overridable to point at Elastic-hosted Jina endpoints. */
export function inferenceIds() {
  return {
    embeddings: process.env.ELASTIC_EMBEDDING_INFERENCE_ID || "jina-embeddings",
    rerank: process.env.ELASTIC_RERANK_INFERENCE_ID || "jina-rerank",
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} failed with ${status}: ${body.slice(0, 2000)}`);
  }
}

type RequestOptions = { body?: unknown; ndjson?: string; allow404?: boolean };

async function request(baseUrl: string, extraHeaders: Record<string, string>, method: string, urlPath: string, opts: RequestOptions = {}) {
  const headers: Record<string, string> = {
    Authorization: `ApiKey ${env("ELASTIC_API_KEY")}`,
    ...extraHeaders,
  };
  let body: string | undefined;
  if (opts.ndjson !== undefined) {
    headers["Content-Type"] = "application/x-ndjson";
    body = opts.ndjson;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(new URL(urlPath, baseUrl), { method, headers, body });
  const text = await res.text();
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) throw new HttpError(res.status, text, `${method} ${urlPath}`);
  return text ? JSON.parse(text) : {};
}

/** Calls the Elasticsearch REST API. Returns null on 404 when allow404 is set. */
export function es(method: string, urlPath: string, opts?: RequestOptions) {
  return request(env("ELASTICSEARCH_URL"), {}, method, urlPath, opts);
}

/** Calls the Kibana REST API (Agent Builder lives here). */
export function kibana(method: string, urlPath: string, opts?: RequestOptions) {
  return request(env("KIBANA_URL"), { "kbn-xsrf": "true" }, method, urlPath, opts);
}

export async function readJson<T = any>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(ELASTIC_DIR, relativePath), "utf8"));
}

export async function listJson(relativeDir: string): Promise<string[]> {
  const files = await readdir(path.join(ELASTIC_DIR, relativeDir));
  return files.filter((f) => f.endsWith(".json")).map((f) => path.join(relativeDir, f));
}
