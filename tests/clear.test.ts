import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("clear chat hides old messages and keeps them out of the model's context, but still counts them", async () => {
  const t = setup();
  const { calls } = mockApis({ core: [{ content: "Old answer." }, { content: "New answer." }] });
  const { as } = await createAppUser(t);
  await as.mutation(api.chat.send, { text: "my secret old question about headaches" });
  await drain(t);
  expect(await as.query(api.chat.list)).toHaveLength(2);

  vi.advanceTimersByTime(1000);
  await as.mutation(api.chat.clear);
  expect(await as.query(api.chat.list)).toEqual([]);

  vi.advanceTimersByTime(1000);
  await as.mutation(api.chat.send, { text: "new question about headaches" });
  await drain(t);
  expect((await as.query(api.chat.list)).map((m: any) => m.text)).toEqual(["new question about headaches", "New answer."]);
  // Neither the recent history nor memory search brings back the cleared conversation.
  expect(JSON.stringify(cortexCalls(calls).at(-1)!.body.messages)).not.toContain("secret old question");
  // Cleared messages aren't deleted.
  expect(await t.run((ctx) => ctx.db.query("messages").collect())).toHaveLength(4);
});

test("clear chat needs sign-in", async () => {
  const t = setup();
  mockApis();
  await expect(t.mutation(api.chat.clear)).rejects.toThrow(/Not signed in/);
});
