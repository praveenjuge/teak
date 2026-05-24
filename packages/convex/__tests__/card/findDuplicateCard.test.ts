// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { r2Mocks, r2MockModuleFactory } from "../helpers/r2Mock.test-utils";

mock.module("../../storage/r2", r2MockModuleFactory);

describe("card/findDuplicateCard.ts", () => {
  let findDuplicateCard: any;

  beforeEach(async () => {
    r2Mocks.resolveObjectUrl.mockReset();
    r2Mocks.resolveObjectUrl.mockResolvedValue(null);
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
      fileKey: "f1",
      thumbnailKey: "t1",
      metadata: {
        linkPreview: {
          screenshotStorageKey: "s1",
          imageStorageKey: "i1",
        },
      },
    };

    r2Mocks.resolveObjectUrl.mockImplementation(async (key) =>
      key ? `file://${key}` : null
    );

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
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: "file://f1",
      thumbnailUrl: "file://t1",
      screenshotUrl: "file://s1",
      linkPreviewMedia: undefined,
      linkPreviewImageUrl: "file://i1",
    });
  });

  test("handles card with minimal storage keys", async () => {
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
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: undefined,
      thumbnailUrl: undefined,
      screenshotUrl: undefined,
      linkPreviewMedia: undefined,
      linkPreviewImageUrl: undefined,
    });
    expect(r2Mocks.resolveObjectUrl).not.toHaveBeenCalled();
  });

  test("handles card with only fileKey", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "image",
      url: "https://example.com/image.jpg",
      fileKey: "f1",
    };

    r2Mocks.resolveObjectUrl.mockResolvedValue("file://f1");

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
    } as any;

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com/image.jpg" });

    expect(result).toEqual({
      ...duplicateCard,
      fileUrl: "file://f1",
      thumbnailUrl: undefined,
      screenshotUrl: undefined,
      linkPreviewMedia: undefined,
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
