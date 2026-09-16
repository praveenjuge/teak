// @ts-nocheck

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { withTestSession } from "../helpers/session.test-utils";

// No `storage/r2` mock: URL hydration resolves through the unmocked
// `storage/fileUrls` leaf, so these tests assert real signed-URL shapes.
const FILES_BASE = "https://files.example.com";
const FILES_SECRET = "test-secret-for-urls";
const PREVIOUS_ENV = {
  FILES_BASE: process.env.FILES_BASE,
  FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
};

beforeEach(() => {
  process.env.FILES_BASE = FILES_BASE;
  process.env.FILES_SIGNING_SECRET = FILES_SECRET;
  delete process.env.R2_KEY_PREFIX;
});

afterEach(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("card/findDuplicateCard.ts", () => {
  let findDuplicateCard: any;

  beforeEach(async () => {
    findDuplicateCard = (await import("../../card/findDuplicateCard"))
      .findDuplicateCard;
  });

  test("returns null when unauthenticated", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);
    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });
    expect(result).toBeNull();
  });

  test("returns null when no duplicate found", async () => {
    const ctx = withTestSession({
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
    } as any);

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });
    expect(result).toBeNull();
  });

  test("returns duplicate card with all URLs", async () => {
    const fileKey = "users/u1/cards/c1/file/f1";
    const thumbnailKey = "users/u1/cards/c1/thumbnail/t1";
    const screenshotKey = "users/u1/cards/c1/screenshot/s1";
    const imageKey = "users/u1/cards/c1/link/i1";
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "link",
      url: "https://example.com",
      fileKey,
      thumbnailKey,
      metadata: {
        linkPreview: {
          screenshotStorageKey: screenshotKey,
          imageStorageKey: imageKey,
        },
      },
    };

    const ctx = withTestSession({
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
    } as any);

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com" });

    expect(result).toMatchObject({ ...duplicateCard, detailUrl: undefined });
    expect(result.fileUrl).toContain(`${FILES_BASE}/${fileKey}?`);
    expect(result.thumbnailUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(thumbnailKey)}`
    );
    expect(result.screenshotUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(screenshotKey)}`
    );
    expect(result.linkPreviewMedia).toBeUndefined();
    expect(result.linkPreviewImageUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(imageKey)}`
    );
  });

  test("handles card with minimal storage keys", async () => {
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "link",
      url: "https://example.com",
    };

    const ctx = withTestSession({
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
    } as any);

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
  });

  test("handles card with only fileKey", async () => {
    const fileKey = "users/u1/cards/c1/file/f1";
    const duplicateCard = {
      _id: "c1",
      _creationTime: 1,
      userId: "u1",
      type: "image",
      url: "https://example.com/image.jpg",
      fileKey,
    };

    const ctx = withTestSession({
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
    } as any);

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    const result = await handler(ctx, { url: "https://example.com/image.jpg" });

    expect(result).toMatchObject({
      ...duplicateCard,
      screenshotUrl: undefined,
      linkPreviewMedia: undefined,
      linkPreviewImageUrl: undefined,
    });
    expect(result.fileUrl).toContain(`${FILES_BASE}/${fileKey}?`);
    const encodedKey = encodeURIComponent(fileKey);
    expect(result.compactUrl).toContain(`/__images/v1/compact/${encodedKey}`);
    expect(result.detailUrl).toContain(`/__images/v1/detail/${encodedKey}`);
    expect(result.placeholderUrl).toContain(`/__images/v1/tiny/${encodedKey}`);
    expect(result.thumbnailUrl).toContain(`/__images/v1/grid/${encodedKey}`);
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

    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue(queryMock),
      },
    } as any);

    const handler = (findDuplicateCard as any).handler ?? findDuplicateCard;
    await handler(ctx, { url: "https://example.com" });

    expect(ctx.db.query).toHaveBeenCalledWith("cards");
    expect(queryMock.withIndex).toHaveBeenCalledWith(
      "by_user_url_deleted",
      expect.any(Function)
    );
  });
});
