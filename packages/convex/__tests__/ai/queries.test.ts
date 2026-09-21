// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("ai/queries.ts", () => {
  let getCardForAI: any;
  let findCardsMissingAi: any;
  let getCardForVerification: any;

  beforeEach(async () => {
    const module = await import("../../ai/queries");
    getCardForAI = module.getCardForAI;
    findCardsMissingAi = module.findCardsMissingAi;
    getCardForVerification = module.getCardForVerification;
  });

  test("getCardForAI fetches card", async () => {
    const ctx = { db: { get: mock().mockResolvedValue({ _id: "c1" }) } } as any;
    const handler = (getCardForAI as any).handler ?? getCardForAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
    expect(result).toEqual({ _id: "c1" });
  });

  test("getCardForAI returns null for missing card", async () => {
    const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
    const handler = (getCardForAI as any).handler ?? getCardForAI;
    const result = await handler(ctx, { cardId: "c1" });
    expect(ctx.db.get).toHaveBeenCalledWith("cards", "c1");
    expect(result).toBeNull();
  });

  const makeIndexedQuery = (batches: any[][]) => {
    const ranges: Array<{ eq: any; lt: any }> = [];
    const limits: number[] = [];
    const mockQuery = {
      withIndex: mock().mockImplementation((_name: string, callback: any) => {
        const range = {
          eq: mock().mockReturnThis(),
          lt: mock().mockReturnThis(),
        };
        callback(range);
        ranges.push(range);
        return mockQuery;
      }),
      take: mock().mockImplementation((limit: number) => {
        limits.push(limit);
        return Promise.resolve(batches[limits.length - 1] ?? []);
      }),
    } as any;
    return { mockQuery, ranges, limits };
  };

  test("findCardsMissingAi maps both active-card representations", async () => {
    const { mockQuery, limits } = makeIndexedQuery([
      [{ _id: "unset" }],
      [{ _id: "false" }],
    ]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toEqual([{ cardId: "unset" }, { cardId: "false" }]);
    expect(limits).toEqual([50, 49]);
  });

  test("findCardsMissingAi applies complete AI, deletion, and age bounds", async () => {
    const { mockQuery, ranges } = makeIndexedQuery([[], []]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    await handler(ctx, {});
    expect(mockQuery.withIndex).toHaveBeenCalledTimes(2);
    expect(mockQuery.withIndex.mock.calls[0][0]).toBe(
      "by_aiSummary_aiTags_aiTranscript_isDeleted_createdAt"
    );
    for (const [index, isDeleted] of [undefined, false].entries()) {
      expect(ranges[index].eq.mock.calls).toEqual([
        ["aiSummary", undefined],
        ["aiTags", undefined],
        ["aiTranscript", undefined],
        ["isDeleted", isDeleted],
      ]);
      expect(ranges[index].lt).toHaveBeenCalledWith(
        "createdAt",
        expect.any(Number)
      );
    }
  });

  test("findCardsMissingAi caps the batch without a second query", async () => {
    const cards = Array.from({ length: 50 }, (_, i) => ({ _id: `c${i}` }));
    const { mockQuery, limits } = makeIndexedQuery([cards]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({ cardId: "c0" });
    expect(limits).toEqual([50]);
  });

  test("getCardForVerification returns null when card missing", async () => {
    const ctx = { db: { get: mock().mockResolvedValue(null) } } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toBeNull();
  });

  test("getCardForVerification returns null when missing or wrong user", async () => {
    const ctx = {
      db: { get: mock().mockResolvedValue({ userId: "u2" }) },
    } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toBeNull();
  });

  test("getCardForVerification returns exists when match", async () => {
    const ctx = {
      db: { get: mock().mockResolvedValue({ userId: "u1" }) },
    } as any;
    const handler =
      (getCardForVerification as any).handler ?? getCardForVerification;
    const result = await handler(ctx, { cardId: "c1", userId: "u1" });
    expect(result).toEqual({ exists: true });
  });
});
