import { describe, expect, test } from "bun:test";
import {
  createCardConvex,
  createFakeOps,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import type { FilesOpCaller } from "../deps";
import type { WorkflowTelemetry } from "../telemetry";
import { runDecision } from "./decisions";

const recordingTelemetry = () => {
  const events: Record<string, unknown>[] = [];
  const telemetry: WorkflowTelemetry = {
    flush: () => Promise.resolve(),
    record: (_name, properties) => {
      events.push(properties as Record<string, unknown>);
    },
  };
  return { events, telemetry };
};

const decide = async (
  answer: OpAnswer | FilesOpCaller,
  options: { timeoutMs?: number; userId?: string } = {}
) => {
  const convex = createCardConvex(makeCard());
  const fakes = createFakeOps(
    typeof answer === "function" ? {} : { "decide-card-type": answer }
  );
  const env = testEnv();
  const ops = typeof answer === "function" ? answer : fakes.ops;
  const { events, telemetry } = recordingTelemetry();
  const result = await runDecision(
    testJob(env, testDeps(env, convex.fetcher, ops)),
    {
      op: "decide-card-type",
      params: { content: "hi", rulesType: "text" },
      read: (data) =>
        data && typeof data === "object" && "decision" in data
          ? (data as { decision: unknown; usage?: unknown })
          : null,
      telemetry,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      userId: "userId" in options ? options.userId : USER_ID,
    }
  );
  return { convex, events, fakes, result };
};

describe("decisions in card steps", () => {
  test("a reply is read and recorded as an AI generation", async () => {
    const { events, result } = await decide({
      data: {
        decision: { confidence: 0.9, type: "quote" },
        usage: { inputTokens: 70, outputTokens: 0 },
      },
    });
    expect(result).toMatchObject({ decision: { type: "quote" } });
    expect(events).toEqual([
      expect.objectContaining({
        $ai_input_tokens: 70,
        $ai_is_error: false,
        $ai_model: "@cf/cloudflare/clef-flash",
        $ai_span_name: "teak.ai.decision.decide-card-type",
      }),
    ]);
  });

  test("an invalid reply is no decision, recorded as an error", async () => {
    const { events, result } = await decide({ data: { nonsense: true } });
    expect(result).toBeNull();
    expect(events).toEqual([expect.objectContaining({ $ai_is_error: true })]);
  });

  test("a declined op is no decision", async () => {
    const { result } = await decide({ fallback: "UNSUPPORTED" });
    expect(result).toBeNull();
  });

  test("a slow op is abandoned after the timeout", async () => {
    const { result } = await decide(() => new Promise(() => undefined), {
      timeoutMs: 5,
    });
    expect(result).toBeNull();
  });

  test("a card without an owner asks no one", async () => {
    const { convex, fakes, result } = await decide(
      { data: { decision: null } },
      { userId: undefined }
    );
    expect(result).toBeNull();
    expect(fakes.calls).toEqual([]);
    expect(convex.callsTo("adminAccess:getAiGate")).toEqual([]);
  });
});
