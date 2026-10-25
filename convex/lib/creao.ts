// CREAO "Symptom & Biosensor Health Analyzer" agent (see creao/), run through its app-scoped API Trigger.
// Runs take minutes, so they're started in the background and finished by webhook or polling (convex/creao.ts).
import { Infer } from "convex/values";
import { creaoInputs } from "../schema";
import { env } from "./env";

const DEFAULT_APP_ID = "4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c";
const BASE = "https://agent.creao.ai/api/v1/apps";
const MAX_FIELD = 4000;

export const CREAO_APP_ID = () => process.env.CREAO_APP_ID || DEFAULT_APP_ID;

// The agent's form fields (creao/config.yaml). Only `symptoms` is required.
export type CreaoInputs = Infer<typeof creaoInputs>;

const TEXT_FIELDS = ["symptom_duration", "chronic_conditions", "biosensor_data", "cycle_data", "last_period_start"] as const;
const SEXES = ["female", "male", "other", "unspecified"] as const;

// Turns the model's analyze_symptoms arguments into the agent's form inputs, or says what's wrong.
export function parseInputs(rawArgs: string): { inputs: CreaoInputs } | { error: string } {
  let args: any;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { error: "arguments are not valid JSON" };
  }
  const symptoms = String(args.symptoms ?? "").trim().slice(0, MAX_FIELD);
  if (!symptoms) return { error: "symptoms is required" };
  const inputs: CreaoInputs = { symptoms };
  for (const field of TEXT_FIELDS) {
    const value = String(args[field] ?? "").trim().slice(0, MAX_FIELD);
    if (value) inputs[field] = value;
  }
  const age = Number(args.age);
  if (Number.isInteger(age) && age > 0 && age < 120) inputs.age = age;
  if (SEXES.includes(args.sex)) inputs.sex = args.sex;
  return { inputs };
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type CreaoRun = {
  id: string;
  status: RunStatus;
  result?: { text?: string; chatText?: string } | null;
  errorCode?: string;
};

function headers() {
  return { Authorization: `Bearer ${env("CREAO_API_KEY")}`, "Content-Type": "application/json" };
}

export async function startRun(inputs: CreaoInputs, webhookUrl?: string): Promise<CreaoRun> {
  const res = await fetch(`${BASE}/${CREAO_APP_ID()}/runs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ inputs, ...(webhookUrl ? { webhookUrl } : {}) }),
  });
  if (!res.ok) throw new Error(`CREAO ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function getRun(runId: string): Promise<CreaoRun> {
  const res = await fetch(`${BASE}/${CREAO_APP_ID()}/runs/${encodeURIComponent(runId)}`, { headers: headers() });
  if (!res.ok) throw new Error(`CREAO ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// The agent's report text. The final answer is in result.text; chatText is only set when it differs.
export function reportText(run: CreaoRun): string | undefined {
  return run.result?.text?.trim() || run.result?.chatText?.trim() || undefined;
}

// Where CREAO should POST the finished result. CREAO rejects localhost and private addresses, so a local
// deployment gets no webhook and relies on polling alone. The secret in the URL proves the call came from a
// run we started; the result itself is always re-fetched from CREAO, never taken from the webhook body.
export function webhookUrl(): string | undefined {
  const site = process.env.CONVEX_SITE_URL;
  const secret = process.env.CREAO_WEBHOOK_SECRET;
  if (!site || !secret) return undefined;
  const host = new URL(site).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return undefined;
  return `${site.replace(/\/$/, "")}/creao?token=${encodeURIComponent(secret)}`;
}
