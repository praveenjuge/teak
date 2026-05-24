// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

const resolveObjectUrlMock = mock((key?: string) =>
  Promise.resolve(key ? `file://${key}` : null)
);

mock.module("../../storage/r2", () => ({
  deleteObject: mock(() => Promise.resolve()),
  resolveObjectUrl: resolveObjectUrlMock,
}));

const buildQuery = (cards: any[]) => ({
  withIndex: mock().mockImplementation(() => buildQuery(cards)),
  order: mock().mockImplementation(() => buildQuery(cards)),
  take: mock().mockResolvedValue(cards),
});

describe("card/getCard.ts", () => {
  let getCard: any;
  let getCardByUrlId: any;
  let getDeletedCards: any;

  beforeEach(async () => {
    const module = await import("../../card/getCard");
    getCard = module.getCard;
    getCardByUrlId = module.getCardByUrlId;
    getDeletedCards = module.getDeletedCards;
  });

  test("getCard returns null when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
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
          fileKey: "f1",
          thumbnailKey: "t1",
          metadata: { linkPreview: { screenshotStorageKey: "s1" } },
        }),
      },
    } as any;

    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });
    expect(result.content).toBe("Hello");
    expect(result.fileUrl).toBe("file://f1");
    expect(result.thumbnailUrl).toBe("file://t1");
    expect(result.screenshotUrl).toBe("file://s1");
  });

  test("getCardByUrlId returns null for malformed ids", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockImplementation(() => {
          throw new Error("invalid id");
        }),
      },
      storage: { getUrl: mock() },
    } as any;

    const handler = (getCardByUrlId as any).handler ?? getCardByUrlId;
    const result = await handler(ctx, { id: "12345" });

    expect(result).toBeNull();
  });

  test("getCard hydrates stored link media and falls back preview image to first attachment", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          type: "link",
          content: "X post",
          metadata: {
            linkPreview: {
              media: [
                {
                  type: "image",
                  storageKey: "img1",
                  updatedAt: 1,
                  width: 1200,
                  height: 900,
                },
                {
                  type: "video",
                  storageKey: "vid1",
                  posterStorageKey: "poster1",
                  updatedAt: 1,
                },
              ],
            },
          },
        }),
      },
    } as any;

    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });

    expect(result.linkPreviewImageUrl).toBe("file://img1");
    expect(result.linkPreviewMedia).toEqual([
      {
        type: "image",
        url: "file://img1",
        contentType: undefined,
        width: 1200,
        height: 900,
        posterUrl: undefined,
        posterContentType: undefined,
        posterWidth: undefined,
        posterHeight: undefined,
      },
      {
        type: "video",
        url: "file://vid1",
        contentType: undefined,
        width: undefined,
        height: undefined,
        posterUrl: "file://poster1",
        posterContentType: undefined,
        posterWidth: undefined,
        posterHeight: undefined,
      },
    ]);
  });

  test("getDeletedCards returns deleted list", async () => {
    const cards = [
      {
        _id: "c1",
        _creationTime: 1,
        userId: "u1",
        type: "text",
        content: "Hi",
      },
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
