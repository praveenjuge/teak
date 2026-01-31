// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("card/findDuplicateCard.ts", () => {
  let findDuplicateCard: any;

  beforeEach(async () => {
    findDuplicateCard = (await import("../../card/findDuplicateCard"))
      .findDuplicateCard;
  });

  test("returns null when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });
    expect(result).toBeNull();
  });

  test("returns null when no duplicate found", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              first: mock().mockResolvedValue(null),
            }),
          }),
        }),
      },
      storage: { getUrl: mock() },
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });
    expect(result).toBeNull();
  });

  test("returns duplicate card with all URLs", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "link",
      url: "https://example.com",
      fileId: "f1",
      thumbnailId: "t1",
      metadata: {
        linkPreview: {
          screenshotStorageId: "s1",
          imageStorageId: "i1",
        },
      },
    };

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              first: mock().mockResolvedValue(duplicateCard),
            }),
          }),
        }),
      },
      storage: {
        getUrl: mock((id) => Promise.resolve(`file://${id}`)),
      },
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: "file://f1",
      thumbnailUrl: "file://t1",
      screenshotUrl: "file://s1",
      linkPreviewImageUrl: "file://i1",
    });
  });

  test("handles card with minimal storage IDs", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "link",
      url: "https://example.com",
    };

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              first: mock().mockResolvedValue(duplicateCard),
            }),
          }),
        }),
      },
      storage: { getUrl: mock() },
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: undefined,
      thumbnailUrl: undefined,
      screenshotUrl: undefined,
      linkPreviewImageUrl: undefined,
    });
    expect(ctx.storage.getUrl).not.toHaveBeenCalled();
  });

  test("handles card with only fileId", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "image",
      url: "https://example.com/image.jpg",
      fileId: "f1",
    };

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            order: mock().mockReturnValue({
              first: mock().mockResolvedValue(duplicateCard),
            }),
          }),
        }),
      },
      storage: {
        getUrl: mock().mockResolvedValue("file://f1"),
      },
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com/image.jpg" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: "file://f1",
      thumbnailUrl: undefined,
      screenshotUrl: undefined,
      linkPreviewImageUrl: undefined,
    });
  });

  test("uses by_user_url_deleted index", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "link",
      url: "https://example.com",
    };

    const queryMock = {
      withIndex: mock().mockReturnValue({
        order: mock().mockReturnValue({
          first: mock().mockResolvedValue(duplicateCard),
        }),
      }),
    };

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue(queryMock),
      },
      storage: { getUrl: mock() },
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    await handler(ctx, { url: "https://example.com" });

    expect(ctx.db.query).toHaveBeenCalledWith("cards");
    expect(queryMock.withIndex).toHaveBeenCalledWith(
      "by_user_url_deleted",
      expect.any(Function)
    );
  });
});
