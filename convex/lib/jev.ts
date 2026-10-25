// Jev (TypeSafe AI's decision model) routes each message: emergency triage, proactive supply shopping, the CREAO
// symptom analyzer (only with the user's OK), or just the regular assistant. Answers are probabilities, never text.
import { env } from "./env";

const URL = "https://api.typesafe.ai/v1/systemone";
const YES = 0.5;
// Higher bar for offering an analysis: a plain "I have a headache" scores around 0.5.
const ANALYSIS_YES = 0.7;
const MAX_CONTEXT = 1500;

export type Route = {
  urgent: boolean; // possible emergency: point the user to urgent care / the ER, never shop
  needsSupplies: boolean; // start the shopper proactively
  wantsAnalysis: boolean; // the symptom analyzer would help
  consent: boolean; // the user asked for, or agreed to, the analysis
};

export const NO_ROUTE: Route = { urgent: false, needsSupplies: false, wantsAnalysis: false, consent: false };

const QUESTIONS = {
  urgent: {
    type: "noul",
    instructions:
      "Does the user describe a possible medical emergency that needs care right now (for example chest pain, trouble " +
      "breathing, stroke signs, severe bleeding, suicidal thoughts, an overdose or a severe allergic reaction)?",
  },
  needs_supplies: {
    type: "noul",
    instructions:
      "Does the user describe a current symptom or situation that over-the-counter supplies could help with right now " +
      "(period or cramps, headache or migraine, allergies or pollen, diabetes supplies running low, recovering from " +
      "surgery or an injury), or ask to buy or restock health supplies?",
  },
  wants_analysis: {
    type: "noul",
    instructions:
      "Does the user want to know what condition could be causing their symptoms, ask for a diagnosis or a detailed " +
      "analysis, or share several symptoms, health-app metrics or menstrual-cycle details to be analyzed?",
  },
  consent: {
    type: "noul",
    instructions:
      "Does the user explicitly ask for, or agree to, a detailed analysis of their symptoms (for example answering yes " +
      "to the assistant's offer to run one)? Only a clear request or yes counts.",
  },
} as const;

export async function route(opts: {
  text: string;
  lastAssistant?: string;
  analysisOffered: boolean;
}): Promise<Route> {
  const state = [
    opts.lastAssistant ? `Assistant's previous message: ${opts.lastAssistant.slice(0, MAX_CONTEXT)}` : "",
    opts.analysisOffered ? "The assistant offered a detailed symptom analysis and is waiting for the user's answer." : "",
    `User's message: ${opts.text.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("JEV_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.JEV_MODEL ?? "jev-latest",
      state,
      questions: QUESTIONS,
    }),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { answers } = await res.json();
  const yes = (key: string, bar = YES) => typeof answers?.[key]?.noul === "number" && answers[key].noul >= bar;
  return {
    urgent: yes("urgent"),
    needsSupplies: yes("needs_supplies"),
    wantsAnalysis: yes("wants_analysis", ANALYSIS_YES),
    consent: yes("consent"),
  };
}
