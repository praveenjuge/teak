import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";

let workerCalls: Array<{ op: string; params: any }> = [];
let workerAnswer: (params: any) => Promise<unknown>;
let rateLimitOk = true;
let rateLimitCalls = 0;
let ensureRelevanceScores: any;

beforeAll(async () => {
  const actualClient = await import("../../storage/filesWorkerClient");
  mock.module(import.meta.resolve("../../storage/filesWorkerClient"), () => ({
    ...actualClient,
    callFilesWorkerJson: (spec: { op: string; params: any }) => {
      workerCalls.push(spec);
      return workerAnswer(spec.params);
    },
    isFilesWorkerConfigured: () => true,
  }));
  const actualLimits = await import("../../shared/rateLimits");
  mock.module(import.meta.resolve("../../shared/rateLimits"), () => ({
    ...actualLimits,
    rateLimiter: {
      limit: () => {
        rateLimitCalls += 1;
        return Promise.resolve({ ok: rateLimitOk });
      },
    },
  }));
  ({ ensureRelevanceScores } = await import("../../search/relevanceActions"));
});

const card = (id: string, updatedAt = 1) => ({
  _id: id,
  type: "text",
  content: `card ${id}`,
  updatedAt,
});

const scoreAll = (params: any) =>
  Promise.resolve({
    kind: "ok",
    data: {
      model: "@cf/cloudflare/clef-flash",
      version: 1,
      usage: { inputTokens: 1000, outputTokens: 0 },
      scores: params.cards.map((entry: { id: string }, index: number) => ({
        id: entry.id,
        score: 3 - index,
      })),
    },
  });

const makeCtx = (cached: unknown = null, gate = "allowed") => {
  const mutations: Array<{ name: string; args: any }> = [];
  return {
    mutations,
    ctx: {
      runQuery: (ref: unknown) =>
        Promise.resolve(
          getFunctionName(ref as never).endsWith("getAiGate") ? gate : cached
        ),
      runMutation: (ref: unknown, args: any) => {
        mutations.push({ name: getFunctionName(ref as never), args });
        return Promise.resolve(true);
      },
    },
  };
};

beforeEach(() => {
  workerCalls = [];
  workerAnswer = scoreAll;
  rateLimitOk = true;
  rateLimitCalls = 0;
});

describe("ensureRelevanceScores", () => {
  test("scores the candidates, caches them and records the cost", async () => {
    const { ctx, mutations } = makeCtx();
    const result = await ensureRelevanceScores(ctx, {
      candidates: [card("a"), card("b")],
      text: "soup",
      userId: "teak_user",
    });
    expect(result.outcome).toBe("ok");
    expect(result.scores).toEqual([
      { cardId: "a", score: 3, cardUpdatedAt: 1 },
      { cardId: "b", score: 2, cardUpdatedAt: 1 },
    ]);
    expect(workerCalls[0]?.op).toBe("score-relevance");
    expect(workerCalls[0]?.params.query).toBe("soup");
    expect(mutations.map((entry) => entry.name)).toEqual([
      "adminUsage:recordAiUsage",
      "search/relevanceCache:storeScores",
    ]);
    expect(mutations[0]?.args).toMatchObject({
      calls: 1,
      errors: 0,
      inputTokens: 1000,
      costUsd: 0.000_038,
    });
    expect(rateLimitCalls).toBe(1);
  });

  test("only scores cards without a current score", async () => {
    const { ctx } = makeCtx([
      { cardId: "a", score: 3, cardUpdatedAt: 1 },
      { cardId: "b", score: 3, cardUpdatedAt: 1 },
    ]);
    await ensureRelevanceScores(ctx, {
      candidates: [card("a"), card("b", 2), card("c")],
      text: "soup",
      userId: "teak_user",
    });
    expect(
      workerCalls[0]?.params.cards.map((entry: { id: string }) => entry.id)
    ).toEqual(["b", "c"]);
  });

  test("nothing to score asks no model and spends no token", async () => {
    const { ctx } = makeCtx([{ cardId: "a", score: 3, cardUpdatedAt: 1 }]);
    const result = await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      text: "soup",
      userId: "teak_user",
    });
    expect(result.outcome).toBe("ok");
    expect(workerCalls).toEqual([]);
    expect(rateLimitCalls).toBe(0);
  });

  test("a search whose meaning lookup took a token takes no second one", async () => {
    const { ctx } = makeCtx();
    await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      spentToken: true,
      text: "soup",
      userId: "teak_user",
    });
    expect(rateLimitCalls).toBe(0);
    expect(workerCalls).toHaveLength(1);
  });

  test("over the limit, nothing is scored", async () => {
    rateLimitOk = false;
    const { ctx } = makeCtx();
    const result = await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      text: "soup",
      userId: "teak_user",
    });
    expect(result.outcome).toBe("rate_limited");
    expect(workerCalls).toEqual([]);
  });

  test("AI turned off asks no model", async () => {
    const { ctx } = makeCtx(null, "user_disabled");
    const result = await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      text: "soup",
      userId: "teak_user",
    });
    expect(result.outcome).toBe("skipped");
    expect(workerCalls).toEqual([]);
  });

  test("a failing worker or an invalid reply caches nothing", async () => {
    workerAnswer = () =>
      Promise.reject(new Error("files_worker_network_error"));
    const { ctx, mutations } = makeCtx();
    const failed = await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      text: "soup",
      userId: "teak_user",
    });
    expect(failed.outcome).toBe("unavailable");

    workerAnswer = () =>
      Promise.resolve({
        kind: "ok",
        data: { model: "m", version: 1, scores: [{ id: "zzz", score: 1 }] },
      });
    const invalid = await ensureRelevanceScores(ctx, {
      candidates: [card("a")],
      text: "soup",
      userId: "teak_user",
    });
    expect(invalid.outcome).toBe("unavailable");
    expect(mutations.map((entry) => entry.name)).toEqual([
      "adminUsage:recordAiUsage",
      "adminUsage:recordAiUsage",
    ]);
    expect(mutations.every((entry) => entry.args.errors === 1)).toBe(true);
  });

  test("scores at most the top 64", async () => {
    const { ctx } = makeCtx();
    await ensureRelevanceScores(ctx, {
      candidates: Array.from({ length: 80 }, (_, index) => card(`c${index}`)),
      text: "soup",
      userId: "teak_user",
    });
    expect(workerCalls[0]?.params.cards).toHaveLength(64);
  });
});
