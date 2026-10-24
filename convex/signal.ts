import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type ConverseStep = { type: string; reasoning?: string; tool_id?: string; params?: unknown };

/** Sends the user's message to the Signal agent in Elastic Agent Builder and stores the answer + tool trace. */
export const answer = internalAction({
  args: { userId: v.string(), text: v.string(), replyId: v.id("messages") },
  handler: async (ctx, { userId, text, replyId }) => {
    const kibanaUrl = process.env.KIBANA_URL;
    const apiKey = process.env.ELASTIC_API_KEY;
    if (!kibanaUrl || !apiKey) {
      await ctx.runMutation(internal.messages.finish, { replyId, status: "error", text: "Signal isn't connected yet: set KIBANA_URL and ELASTIC_API_KEY in the Convex dashboard." });
      return;
    }

    const conversationId = await ctx.runQuery(internal.messages.latestConversationId, { userId });
    try {
      const res = await fetch(new URL("/api/agent_builder/converse", kibanaUrl), {
        method: "POST",
        headers: { Authorization: `ApiKey ${apiKey}`, "Content-Type": "application/json", "kbn-xsrf": "true" },
        body: JSON.stringify({ input: text, agent_id: "signal", ...(conversationId && { conversation_id: conversationId }) }),
      });
      if (!res.ok) throw new Error(`Agent Builder returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const result = await res.json();

      const steps = ((result.steps ?? []) as ConverseStep[]).map((s) =>
        s.type === "tool_call" ? { type: s.type, toolId: s.tool_id, params: s.params } : { type: s.type, text: s.reasoning },
      );
      await ctx.runMutation(internal.messages.finish, {
        replyId,
        status: "done",
        text: result.response?.message ?? "(no answer)",
        steps,
        conversationId: result.conversation_id,
      });
    } catch (error) {
      console.error(error);
      await ctx.runMutation(internal.messages.finish, { replyId, status: "error", text: "Signal couldn't answer just now. Please try again." });
    }
  },
});
