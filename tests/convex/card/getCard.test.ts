// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

const buildQuery = (cards: any[]) => ({
  withIndex: mock().mockImplementation(() => buildQuery(cards)),
  order: mock().mockImplementation(() => buildQuery(cards)),
  take: mock().mockResolvedValue(cards),
});

describe("card/getCard.ts", () => {
  let getCard: any;
  let getDeletedCards: any;

  beforeEach(async () => {
    const module = await import("../convex/card/getCard");
    getCard = module.getCard;
    getDeletedCards = module.getDeletedCards;
  });

  test("getCard returns null when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });
    expect(result).toBeNull();
  });

  test("getCard attaches urls and formats quote", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          type: "quote",
          content: "'Hello'",
          fileId: "f1",
          thumbnailId: "t1",
          metadata: { linkPreview: { screenshotStorageId: "s1" } },
        }),
      },
      storage: {
        getUrl: mock()
          .mockResolvedValueOnce("file://f1")
          .mockResolvedValueOnce("file://t1")
          .mockResolvedValueOnce("file://s1"),
      },
    } as any;

    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });
    expect(result.content).toBe("Hello");
    expect(result.fileUrl).toBe("file://f1");
    expect(result.thumbnailUrl).toBe("file://t1");
    expect(result.screenshotUrl).toBe("file://s1");
  });

  test("getDeletedCards returns deleted list", async () => {
    const cards = [
      { _id: "c1", _creationTime: 1, userId: "u1", type: "text", content: "Hi" },
    ];
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { query: mock().mockReturnValue(buildQuery(cards)) },
    } as any;

    const handler = (getDeletedCards as any).handler ?? getDeletedCards;
    const result = await handler(ctx, { limit: 1 });
    expect(result.length).toBe(1);
  });
});
