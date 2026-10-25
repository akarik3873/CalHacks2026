// Detailed symptom analysis by the CREAO agent, started from the analyze_symptoms tool.
// request -> start (API Trigger) -> webhook and/or poll -> applyResult -> the report arrives as a new assistant message.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getRun, reportText, startRun, webhookUrl } from "./lib/creao";
import { saveAssistantReply } from "./pipeline";
import { channel, creaoInputs, creaoRunStatus } from "./schema";

// Each run spends CREAO credits, so keep it to one at a time and a few a day per user.
export const DAILY_ANALYSES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
export const POLL_EVERY_MS = 60_000;
export const MAX_POLLS = 20; // ~20 minutes, then give up

const ACTIVE = ["starting", "pending", "running"];

// Called by the pipeline when the model uses analyze_symptoms. Returns text for the model.
export const request = internalMutation({
  args: { userId: v.id("users"), channel, inputs: creaoInputs },
  handler: async (ctx, { userId, channel, inputs }) => {
    if (!process.env.CREAO_API_KEY) return "Tool error: detailed symptom analysis isn't set up (CREAO_API_KEY missing).";
    const recent = await ctx.db
      .query("creaoRuns")
      .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.now() - DAY_MS))
      .collect();
    if (recent.some((r) => ACTIVE.includes(r.status))) {
      return "A detailed analysis for this user is already running; its report will arrive as a separate message. Don't start another.";
    }
    if (recent.length >= DAILY_ANALYSES) {
      return `The user has used today's ${DAILY_ANALYSES} detailed analyses. Answer from what you know and suggest trying again tomorrow.`;
    }
    const id = await ctx.db.insert("creaoRuns", { userId, channel, inputs, status: "starting", polls: 0, delivered: false });
    await ctx.scheduler.runAfter(0, internal.creao.start, { id });
    return (
      "Started a detailed symptom analysis with the CREAO analyzer. It takes a few minutes, and the report will arrive " +
      "as a separate message. Tell the user that briefly, mention their symptoms were sent to the analysis service, " +
      "and don't guess at the result."
    );
  },
});

export const start = internalAction({
  args: { id: v.id("creaoRuns") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.creao.get, { id });
    if (!row || row.status !== "starting") return;
    try {
      const run = await startRun(row.inputs, webhookUrl());
      await ctx.runMutation(internal.creao.started, { id, runId: run.id });
    } catch (e) {
      console.error("CREAO start failed", e);
      await ctx.runMutation(internal.creao.applyResult, { id, status: "failed", errorCode: "start_failed" });
    }
  },
});

export const started = internalMutation({
  args: { id: v.id("creaoRuns"), runId: v.string() },
  handler: async (ctx, { id, runId }) => {
    await ctx.db.patch(id, { runId, status: "pending" });
    await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.creao.poll, { id });
  },
});

// Asks CREAO for the run's current state. Called on a timer and right after a webhook arrives.
export const poll = internalAction({
  args: { id: v.id("creaoRuns"), fromWebhook: v.optional(v.boolean()) },
  handler: async (ctx, { id, fromWebhook }) => {
    const row = await ctx.runQuery(internal.creao.get, { id });
    if (!row?.runId || row.delivered) return;
    try {
      const run = await getRun(row.runId);
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        await ctx.runMutation(internal.creao.applyResult, {
          id,
          status: run.status,
          report: reportText(run),
          errorCode: run.errorCode,
        });
        return;
      }
      await ctx.runMutation(internal.creao.stillRunning, { id, status: run.status, countPoll: !fromWebhook });
    } catch (e) {
      console.error("CREAO poll failed", e);
      await ctx.runMutation(internal.creao.stillRunning, { id, status: row.status, countPoll: !fromWebhook });
    }
  },
});

export const stillRunning = internalMutation({
  args: { id: v.id("creaoRuns"), status: creaoRunStatus, countPoll: v.boolean() },
  handler: async (ctx, { id, status, countPoll }) => {
    const row = await ctx.db.get(id);
    if (!row || row.delivered) return;
    if (!countPoll) return; // a webhook-triggered check doesn't change the polling schedule
    const polls = row.polls + 1;
    if (polls >= MAX_POLLS) {
      await ctx.db.patch(id, { polls });
      await ctx.scheduler.runAfter(0, internal.creao.applyResult, { id, status: "failed", errorCode: "timeout" });
      return;
    }
    await ctx.db.patch(id, { status, polls });
    await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.creao.poll, { id });
  },
});

// Records the final state and sends the user one message about it. Safe to call more than once.
export const applyResult = internalMutation({
  args: { id: v.id("creaoRuns"), status: creaoRunStatus, report: v.optional(v.string()), errorCode: v.optional(v.string()) },
  handler: async (ctx, { id, status, report, errorCode }) => {
    const row = await ctx.db.get(id);
    if (!row || row.delivered) return;
    const ok = status === "completed" && !!report;
    await ctx.db.patch(id, {
      status: ok ? "completed" : status === "completed" ? "failed" : status,
      report,
      errorCode: ok ? undefined : (errorCode ?? (status === "completed" ? "empty_report" : status)),
      delivered: true,
    });
    const text = ok
      ? `**Your detailed symptom analysis is ready** (from the CREAO analysis agent)\n\n${report}`
      : `I couldn't finish the detailed symptom analysis${errorCode === "timeout" ? " (it took too long)" : ""}. ` +
        "You can ask me to try again later. If your symptoms are severe or getting worse, contact a clinician, " +
        "and call 911 in an emergency.";
    await saveAssistantReply(ctx, { userId: row.userId, text, channel: row.channel, urgent: false });
  },
});

// The webhook only says "this run finished"; poll fetches the real result from CREAO with our key.
export const webhookReceived = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const row = await ctx.db
      .query("creaoRuns")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    if (!row || row.delivered) return;
    await ctx.scheduler.runAfter(0, internal.creao.poll, { id: row._id, fromWebhook: true });
  },
});

export const get = internalQuery({
  args: { id: v.id("creaoRuns") },
  handler: (ctx, { id }) => ctx.db.get(id),
});
