// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

const buildQuery = (cards: any[]) => {
  return {
    withIndex: mock().mockImplementation(() => buildQuery(cards)),
    order: mock().mockImplementation(() => buildQuery(cards)),
    take: mock().mockResolvedValue(cards),
  } as any;
};

describe("card/getCards.ts", () => {
  let getCards: any;

  beforeEach(async () => {
    getCards = (await import("../convex/card/getCards")).getCards;
  });

  test("returns empty when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (getCards as any).handler ?? getCards;
    const result = await handler(ctx, {});
    expect(result).toEqual([]);
  });

  test("attaches file urls and formats quotes", async () => {
    const cards = [
      {
        _id: "c1",
        _creationTime: 1,
        userId: "u1",
        content: "\"Hello\"",
        type: "quote",
        fileId: "f1",
        thumbnailId: "t1",
        metadata: { linkPreview: { screenshotStorageId: "s1" } },
      },
    ];
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { query: mock().mockReturnValue(buildQuery(cards)) },
      storage: {
        getUrl: mock()
          .mockResolvedValueOnce("file://f1")
          .mockResolvedValueOnce("file://t1")
          .mockResolvedValueOnce("file://s1"),
      },
    } as any;

    const handler = (getCards as any).handler ?? getCards;
    const result = await handler(ctx, { limit: 1 });
    expect(result[0].content).toBe("Hello");
    expect(result[0].fileUrl).toBe("file://f1");
    expect(result[0].thumbnailUrl).toBe("file://t1");
    expect(result[0].screenshotUrl).toBe("file://s1");
  });

  test("uses favorites index when favoritesOnly", async () => {
    const cards: any[] = [];
    const query = buildQuery(cards);
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { query: mock().mockReturnValue(query) },
      storage: { getUrl: mock() },
    } as any;

    const handler = (getCards as any).handler ?? getCards;
    await handler(ctx, { favoritesOnly: true });
    expect(ctx.db.query).toHaveBeenCalledWith("cards");
    expect(query.withIndex).toHaveBeenCalled();
  });
});
