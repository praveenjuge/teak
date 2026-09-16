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
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);
    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });
    expect(result).toBeNull();
  });

  test("getCard attaches urls and formats quote", async () => {
    const fileKey = "users/u1/cards/c1/file/f1";
    const thumbnailKey = "users/u1/cards/c1/thumbnail/t1";
    const screenshotKey = "users/u1/cards/c1/screenshot/s1";
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          type: "quote",
          content: "'Hello'",
          fileKey,
          thumbnailKey,
          metadata: { linkPreview: { screenshotStorageKey: screenshotKey } },
        }),
      },
    } as any);

    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });
    expect(result.content).toBe("Hello");
    expect(result.fileUrl).toContain(`${FILES_BASE}/${fileKey}?`);
    expect(result.thumbnailUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(thumbnailKey)}`
    );
    expect(result.screenshotUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(screenshotKey)}`
    );
  });

  test("getCardByUrlId returns null for malformed ids", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockImplementation(() => {
          throw new Error("invalid id");
        }),
      },
      storage: { getUrl: mock() },
    } as any);

    const handler = (getCardByUrlId as any).handler ?? getCardByUrlId;
    const result = await handler(ctx, { id: "12345" });

    expect(result).toBeNull();
  });

  test("getCard hydrates stored link media and falls back preview image to first attachment", async () => {
    const imageKey = "users/u1/cards/c1/link/img1";
    const videoKey = "users/u1/cards/c1/link/vid1";
    const posterKey = "users/u1/cards/c1/link/poster1";
    const ctx = withTestSession({
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
                  storageKey: imageKey,
                  updatedAt: 1,
                  width: 1200,
                  height: 900,
                },
                {
                  type: "video",
                  storageKey: videoKey,
                  posterStorageKey: posterKey,
                  updatedAt: 1,
                },
              ],
            },
          },
        }),
      },
    } as any);

    const handler = (getCard as any).handler ?? getCard;
    const result = await handler(ctx, { id: "c1" });

    expect(result.linkPreviewImageUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(imageKey)}`
    );
    expect(result.linkPreviewMedia).toHaveLength(2);
    expect(result.linkPreviewMedia[0]).toMatchObject({
      type: "image",
      width: 1200,
      height: 900,
    });
    expect(result.linkPreviewMedia[0].url).toContain(
      `/__images/v1/grid/${encodeURIComponent(imageKey)}`
    );
    expect(result.linkPreviewMedia[1]).toMatchObject({ type: "video" });
    expect(result.linkPreviewMedia[1].url).toContain(
      `${FILES_BASE}/${videoKey}?`
    );
    expect(result.linkPreviewMedia[1].posterUrl).toContain(
      `/__images/v1/grid/${encodeURIComponent(posterKey)}`
    );
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
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { query: mock().mockReturnValue(buildQuery(cards)) },
    } as any);

    const handler = (getDeletedCards as any).handler ?? getDeletedCards;
    const result = await handler(ctx, { limit: 1 });
    expect(result.length).toBe(1);
  });
});
