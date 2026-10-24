// Asks the Signal agent a question through the Agent Builder converse API and prints its tool trace.
// Usage: npm run elastic:ask -- "Why have I been so tired lately?" [conversation_id]

import { kibana } from "./lib.js";

type Step =
  | { type: "reasoning"; reasoning: string }
  | { type: "tool_call"; tool_id: string; params: unknown; results?: unknown[] }
  | { type: string; [key: string]: unknown };

const [input, conversationId] = process.argv.slice(2);
if (!input) {
  console.error('Usage: npm run elastic:ask -- "your question" [conversation_id]');
  process.exit(1);
}

const started = Date.now();
const result = await kibana("POST", "/api/agent_builder/converse", {
  body: { input, agent_id: "signal", ...(conversationId && { conversation_id: conversationId }) },
});

for (const step of (result.steps ?? []) as Step[]) {
  if (step.type === "reasoning") {
    console.log(`\n[thinking] ${step.reasoning}`);
  } else if (step.type === "tool_call") {
    console.log(`\n[tool] ${step.tool_id} ${JSON.stringify(step.params)}`);
    console.log(`       ${JSON.stringify(step.results ?? []).slice(0, 600)}`);
  } else {
    console.log(`\n[${step.type}]`);
  }
}

console.log(`\n--- answer (${((Date.now() - started) / 1000).toFixed(1)}s) ---\n${result.response?.message}`);
console.log(`\nconversation_id: ${result.conversation_id}`);
