// Tools the core model can call. Each returns plain text for the model.
import { ToolDef } from "./cortex";
import { read, search } from "./jina";

export const toolDefs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web. Use for current info, local services (e.g. nearby urgent care), or anything you are unsure about.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Read the text of a web page by URL.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bio_research",
      description:
        "Research a medical/biology question in PubMed papers. Returns abstracts from the top sources to summarize and cite.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
];

// Handled in the pipeline since it writes to the user's record.
export const saveLocationTool: ToolDef = {
  type: "function",
  function: {
    name: "save_location",
    description: "Remember the user's location (city, zip, or address) for finding nearby care later.",
    parameters: {
      type: "object",
      properties: { location: { type: "string", description: "e.g. 'Berkeley, CA 94704'" } },
      required: ["location"],
    },
  },
};

// Handled in the pipeline: it starts a background CREAO run for this user (convex/creao.ts).
export const analyzeSymptomsTool: ToolDef = {
  type: "function",
  function: {
    name: "analyze_symptoms",
    description:
      "Start a detailed analysis of the user's symptoms by the CREAO symptom analyzer, which ranks the 1-3 most likely " +
      "conditions with reasoning and care guidance. Use only when the user asks what could be causing their symptoms " +
      "or asks for a detailed analysis. It runs in the background; the report arrives as a separate message in a few " +
      "minutes. Sends what the user told you to the analysis service. Pass only details the user actually gave.",
    parameters: {
      type: "object",
      properties: {
        symptoms: { type: "string", description: "Each symptom with onset, severity, pattern, triggers, and any negatives the user mentioned" },
        symptom_duration: { type: "string", description: "How long, and whether it's worsening, stable or improving" },
        age: { type: "integer" },
        sex: { type: "string", enum: ["female", "male", "other", "unspecified"] },
        chronic_conditions: { type: "string", description: "Existing long-term diagnoses and regular medications" },
        biosensor_data: { type: "string", description: "Health app metrics the user shared (heart rate, sleep, steps, etc.)" },
        cycle_data: { type: "string", description: "Menstrual cycle history the user shared" },
        last_period_start: { type: "string" },
      },
      required: ["symptoms"],
    },
  },
};

export async function runTool(name: string, rawArgs: string): Promise<string> {
  try {
    const args = JSON.parse(rawArgs || "{}");
    switch (name) {
      case "web_search":
        return format(await search(args.query));
      case "read_page":
        return await read(args.url);
      case "bio_research": {
        const results = await search(args.question, "pubmed.ncbi.nlm.nih.gov");
        const pages = await Promise.all(
          results.slice(0, 3).map(async (r) => {
            const text = await read(r.url, 2500).catch(() => r.content);
            return `## ${r.title}\n${r.url}\n${text}`;
          }),
        );
        return pages.join("\n\n") || "No papers found.";
      }
      default:
        return `Unknown tool ${name}`;
    }
  } catch (e) {
    return `Tool error: ${(e as Error).message}`;
  }
}

function format(results: { title: string; url: string; content: string }[]) {
  if (!results.length) return "No results.";
  return results.map((r) => `- ${r.title} (${r.url})\n  ${r.content}`).join("\n");
}
