import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

let workerCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
let decision: { type: string; confidence: number } | null = null;
let workerFails = false;
let aiGate = "allowed";
let classify: (ctx: unknown, args: { cardId: string }) => Promise<any>;

beforeAll(async () => {
  mock.module(
    import.meta.resolve("../../../storage/filesWorkerClient"),
    () => ({
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        workerCalls.push(spec);
        if (workerFails) {
          return Promise.reject(new Error("files_worker_network_error"));
        }
        return Promise.resolve({
          kind: "ok",
          data: { model: "@cf/cloudflare/clef-flash", version: 1, decision },
        });
      },
      isFilesWorkerConfigured: () => true,
    })
  );
  const module = await import("../../../workflows/steps/classification");
  classify = (module.classify as any)._handler;
});

beforeEach(() => {
  workerCalls = [];
  decision = null;
  workerFails = false;
  aiGate = "allowed";
});

const run = async (card: Record<string, unknown>) => {
  const recorded: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: (ref: unknown) =>
      Promise.resolve(
        getFunctionName(ref as never).endsWith("getAiGate") ? aiGate : card
      ),
    runMutation: (_ref: unknown, args: Record<string, unknown>) => {
      recorded.push(args);
      return Promise.resolve(null);
    },
  };
  const result = await classify(ctx, { cardId: "c1" });
  return { recorded, result };
};

const note = (content: string, type = "text") => ({
  _id: "c1",
  userId: "teak_user",
  type,
  content,
});

describe("card type review by Clef", () => {
  test("an unquoted quotation becomes a quote", async () => {
    decision = { type: "quote", confidence: 0.92 };
    const { recorded, result } = await run(
      note("Make it work, then make it fast. — my old teacher")
    );
    expect(result).toMatchObject({ type: "quote", confidence: 0.92 });
    expect(recorded[0]).toMatchObject({ type: "quote", confidence: 0.92 });
    expect(workerCalls[0]).toMatchObject({
      op: "decide-card-type",
      params: { rulesType: "text" },
    });
  });

  test("vetoes the quote-mark heuristic", async () => {
    decision = { type: "text", confidence: 0.9 };
    const { result } = await run(note('"Are you coming to dinner tonight?"'));
    expect(result.type).toBe("text");
    expect(workerCalls[0]?.params.rulesType).toBe("quote");
  });

  test("vetoes the palette rule for CSS", async () => {
    decision = { type: "text", confidence: 0.95 };
    const { result } = await run(
      note(".button { color: #ffffff; background: #000000; }")
    );
    expect(result.type).toBe("text");
    expect(workerCalls[0]?.params.rulesType).toBe("palette");
  });

  test("a palette with no colours stays text", async () => {
    decision = { type: "palette", confidence: 0.95 };
    const { result } = await run(note("my favourite things"));
    expect(result.type).toBe("text");
  });

  test.each([
    ["no decision", () => {}],
    [
      "a failing worker",
      () => {
        workerFails = true;
      },
    ],
  ])("keeps the rules with %s", async (_name, arrange) => {
    arrange();
    const { result } = await run(note("#264653 #2a9d8f #e9c46a"));
    expect(result.type).toBe("palette");
  });

  test("an explicitly saved quote is not reviewed", async () => {
    decision = { type: "text", confidence: 0.99 };
    const { result } = await run(note("to be or not to be", "quote"));
    expect(result.type).toBe("quote");
    expect(workerCalls).toEqual([]);
  });

  test("links and files are not reviewed", async () => {
    decision = { type: "quote", confidence: 0.99 };
    await run({ ...note("hi"), url: "https://example.com" });
    expect(workerCalls).toEqual([]);
  });

  test("AI turned off keeps the rules and calls no model", async () => {
    aiGate = "user_disabled";
    decision = { type: "quote", confidence: 0.99 };
    const { result } = await run(note("Make it work. — someone"));
    expect(result.type).toBe("text");
    expect(workerCalls).toEqual([]);
  });
});
