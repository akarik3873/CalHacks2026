// Creates everything the app needs in Elastic, in order:
//   1. Jina inference endpoints (embeddings + rerank)
//   2. The three indices, with semantic_text fields bound to the embeddings endpoint
//   3. Agent Builder tools from elastic/agent/tools/
//   4. The Signal agent from elastic/agent/signal.json
// Safe to re-run: existing endpoints and indices are kept, tools and the agent are replaced.
// Pass --reset to delete and recreate the indices (wipes their data).

import { INDICES, env, es, inferenceIds, kibana, listJson, readJson } from "./lib.js";

const reset = process.argv.includes("--reset");

async function setupInference() {
  const ids = inferenceIds();
  const endpoints = [
    { id: ids.embeddings, file: "inference/jina-embeddings.json", custom: !process.env.ELASTIC_EMBEDDING_INFERENCE_ID },
    { id: ids.rerank, file: "inference/jina-rerank.json", custom: !process.env.ELASTIC_RERANK_INFERENCE_ID },
  ];
  for (const endpoint of endpoints) {
    const existing = await es("GET", `/_inference/${endpoint.id}`, { allow404: true });
    if (existing) {
      console.log(`inference  ${endpoint.id}: exists`);
      continue;
    }
    if (!endpoint.custom) throw new Error(`Inference endpoint ${endpoint.id} from .env does not exist on this project`);

    const { task_type, body } = await readJson<{ task_type: string; body: unknown }>(endpoint.file);
    const withKey = JSON.parse(JSON.stringify(body).replaceAll("${JINA_API_KEY}", env("JINA_API_KEY")));
    await es("PUT", `/_inference/${task_type}/${endpoint.id}`, { body: withKey });
    console.log(`inference  ${endpoint.id}: created`);
  }
}

async function setupIndices() {
  const { embeddings } = inferenceIds();
  for (const index of INDICES) {
    if (reset) {
      await es("DELETE", `/${index}`, { allow404: true });
      console.log(`index      ${index}: deleted`);
    }
    if (await es("GET", `/${index}`, { allow404: true })) {
      console.log(`index      ${index}: exists`);
      continue;
    }
    const mapping = JSON.stringify(await readJson(`mappings/${index}.json`)).replaceAll('"jina-embeddings"', JSON.stringify(embeddings));
    await es("PUT", `/${index}`, { body: JSON.parse(mapping) });
    console.log(`index      ${index}: created`);
  }
}

async function setupAgent() {
  const agent = await readJson<{ id: string }>("agent/signal.json");
  // The agent references the tools, so remove it before replacing them.
  await kibana("DELETE", `/api/agent_builder/agents/${agent.id}`, { allow404: true });

  for (const file of await listJson("agent/tools")) {
    const tool = await readJson<{ id: string }>(file);
    await kibana("DELETE", `/api/agent_builder/tools/${tool.id}`, { allow404: true });
    await kibana("POST", "/api/agent_builder/tools", { body: tool });
    console.log(`tool       ${tool.id}: created`);
  }

  await kibana("POST", "/api/agent_builder/agents", { body: agent });
  console.log(`agent      ${agent.id}: created`);
}

await setupInference();
await setupIndices();
await setupAgent();
console.log("\nDone. Next: npm run elastic:seed");
