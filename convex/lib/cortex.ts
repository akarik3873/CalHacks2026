// Snowflake Cortex via its OpenAI-compatible chat completions endpoint.
import { env } from "./env";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};

export const TRIAGE_MODEL = () => process.env.CORTEX_TRIAGE_MODEL ?? "llama3.1-8b";
export const CORE_MODEL = () => process.env.CORTEX_CORE_MODEL ?? "openai-gpt-5.4";

export async function complete(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const base = env("SNOWFLAKE_ACCOUNT_URL").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v2/cortex/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("SNOWFLAKE_PAT")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      max_completion_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Cortex ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [] };
}
