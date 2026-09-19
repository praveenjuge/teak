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

  const makePagedQuery = (pages: { page: any[]; isDone: boolean }[]) => {
    const calls: { cursor: string | null; numItems: number }[] = [];
    const mockQuery = {
      withIndex: mock().mockReturnThis(),
      paginate: mock().mockImplementation((opts: any) => {
        calls.push(opts);
        const page = pages[calls.length - 1] ?? { page: [], isDone: true };
        return Promise.resolve({
          page: page.page,
          isDone: page.isDone,
          continueCursor: `cursor_${calls.length}`,
        });
      }),
    } as any;
    return { mockQuery, calls };
  };

  test("findCardsMissingAi maps to card ids", async () => {
    const { mockQuery } = makePagedQuery([
      { page: [{ _id: "c1" }, { _id: "c2" }], isDone: true },
    ]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toEqual([{ cardId: "c1" }, { cardId: "c2" }]);
  });

  test("findCardsMissingAi filters for cards older than 5 minutes", async () => {
    const { mockQuery } = makePagedQuery([{ page: [], isDone: true }]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    await handler(ctx, {});

    expect(ctx.db.query).toHaveBeenCalledWith("cards");
    expect(mockQuery.withIndex).toHaveBeenCalledWith(
      "by_aiSummary_created",
      expect.any(Function)
    );
  });

  test("findCardsMissingAi index range applies summary and age bounds", async () => {
    const range: { eq: any; lt: any } = {
      eq: mock().mockReturnThis(),
      lt: mock().mockReturnThis(),
    };
    const mockQuery = {
      withIndex: mock().mockImplementation((_name: string, cb: any) => {
        cb(range);
        return mockQuery;
      }),
      paginate: mock().mockResolvedValue({
        page: [],
        isDone: true,
        continueCursor: "cursor_1",
      }),
    } as any;
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    await handler(ctx, {});
    expect(range.eq).toHaveBeenCalledWith("aiSummary", undefined);
    expect(range.lt).toHaveBeenCalledWith("createdAt", expect.any(Number));
  });

  test("findCardsMissingAi pages 200 candidates at a time", async () => {
    const { mockQuery, calls } = makePagedQuery([{ page: [], isDone: true }]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    await handler(ctx, {});
    expect(calls).toEqual([{ cursor: null, numItems: 200 }]);
  });

  test("findCardsMissingAi handles empty results", async () => {
    const { mockQuery } = makePagedQuery([{ page: [], isDone: true }]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toEqual([]);
  });

  test("findCardsMissingAi post-filters deleted and partially-processed cards", async () => {
    const { mockQuery } = makePagedQuery([
      {
        page: [
          { _id: "keep", isDeleted: false },
          { _id: "deleted", isDeleted: true },
          { _id: "hasTags", aiTags: ["x"] },
          { _id: "hasTranscript", aiTranscript: "t" },
        ],
        isDone: true,
      },
    ]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toEqual([{ cardId: "keep" }]);
  });

  test("findCardsMissingAi keeps paging past a fully ineligible page", async () => {
    const rejected = Array.from({ length: 200 }, (_, i) => ({
      _id: `dead${i}`,
      isDeleted: true,
    }));
    const { mockQuery, calls } = makePagedQuery([
      { page: rejected, isDone: false },
      { page: [{ _id: "eligible" }], isDone: true },
    ]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(calls).toHaveLength(2);
    expect(calls[1].cursor).toBe("cursor_1");
    expect(result).toEqual([{ cardId: "eligible" }]);
  });

  test("findCardsMissingAi caps the batch at 50 cards", async () => {
    const cards = Array.from({ length: 200 }, (_, i) => ({ _id: `c${i}` }));
    const { mockQuery, calls } = makePagedQuery([{ page: cards, isDone: false }]);
    const ctx = { db: { query: mock().mockReturnValue(mockQuery) } } as any;
    const handler = (findCardsMissingAi as any).handler ?? findCardsMissingAi;
    const result = await handler(ctx, {});
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({ cardId: "c0" });
    expect(calls).toHaveLength(1); // full batch reached without another page
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
