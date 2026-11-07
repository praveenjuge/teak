import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { withTestSession } from "../helpers/session.test-utils";

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

const buildQuery = (cards: any[] = []) =>
  ({
    async *[Symbol.asyncIterator]() {
      yield* cards;
    },
    withIndex: mock().mockImplementation(() => buildQuery(cards)),
    withSearchIndex: mock().mockImplementation(() => buildQuery(cards)),
    filter: mock().mockImplementation(() => buildQuery(cards)),
    order: mock().mockImplementation(() => buildQuery(cards)),
    take: mock().mockResolvedValue(cards),
    first: mock().mockResolvedValue(cards[0] ?? null),
    paginate: mock().mockResolvedValue({
      page: cards,
      isDone: true,
      continueCursor: null,
    }),
  }) as any;

const indexedQuery = (cards: any[]) => ({
  withIndex: (_index: string, range?: (q: any) => unknown) => {
    const conditions: [string, unknown][] = [];
    const builder: any = {
      eq: (field: string, value: unknown) => {
        conditions.push([field, value]);
        return builder;
      },
      gt: () => builder,
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
    };
    range?.(builder);
    return buildQuery(
      cards.filter((card) =>
        conditions.every(([field, value]) => card[field] === value)
      )
    );
  },
});

const libraryCards = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    _id: `c${index}`,
    _creationTime: count - index,
    createdAt: count - index,
    userId: "u1",
    content: `Card ${index}`,
    type: "text",
  }));

describe("card/getCards.ts", () => {
  let getCards: any;

  beforeEach(async () => {
    const module = await import("../../card/getCards");
    getCards = module.getCards;
  });

  describe("getCards", () => {
    test("returns empty when unauthenticated", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
      } as any);
      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result).toEqual([]);
    });

    test("attaches file urls and formats quotes", async () => {
      const fileKey = "users/u1/cards/c1/file/f1";
      const thumbnailKey = "users/u1/cards/c1/thumbnail/t1";
      const screenshotKey = "users/u1/cards/c1/screenshot/s1";
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: '"Hello"',
          type: "quote",
          fileKey,
          thumbnailKey,
          metadata: { linkPreview: { screenshotStorageKey: screenshotKey } },
        },
      ];
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, { limit: 1 });
      expect(result[0].content).toBe("Hello");
      expect(result[0].fileUrl).toContain(`${FILES_BASE}/${fileKey}?`);
      expect(result[0].thumbnailUrl).toContain(
        `/__images/v1/grid/${encodeURIComponent(thumbnailKey)}`
      );
      expect(result[0].screenshotUrl).toContain(
        `/__images/v1/grid/${encodeURIComponent(screenshotKey)}`
      );
    });

    test("returns the default number of cards when no limit is given", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(indexedQuery(libraryCards(60))) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result.map((card: { _id: string }) => card._id)).toEqual(
        libraryCards(50).map((card) => card._id)
      );
    });

    test("clamps an oversized limit to the max card limit", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(indexedQuery(libraryCards(250))) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, { limit: 100_000 });
      expect(result).toHaveLength(200);
    });

    test("clamps a non-positive limit up to 1", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(indexedQuery(libraryCards(5))) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, { limit: -10 });
      expect(result.map((card: { _id: string }) => card._id)).toEqual(["c0"]);
    });

    test("attaches linkPreviewImageUrl from metadata", async () => {
      const imageStorageKey = "users/u1/cards/c1/link/img1";
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Hello",
          type: "link",
          metadata: { linkPreview: { imageStorageKey } },
        },
      ];
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result[0].linkPreviewImageUrl).toContain(
        `/__images/v1/grid/${encodeURIComponent(imageStorageKey)}`
      );
    });

    test("hydrates linkPreviewMedia and falls back to the first attached image", async () => {
      const imageKey = "users/u1/cards/c1/link/img1";
      const videoKey = "users/u1/cards/c1/link/vid1";
      const posterKey = "users/u1/cards/c1/link/poster1";
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Hello",
          type: "link",
          metadata: {
            linkPreview: {
              media: [
                {
                  type: "image",
                  storageKey: imageKey,
                  updatedAt: 1,
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
        },
      ];
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result[0].linkPreviewImageUrl).toContain(
        `/__images/v1/grid/${encodeURIComponent(imageKey)}`
      );
      expect(result[0].linkPreviewMedia).toHaveLength(2);
      expect(result[0].linkPreviewMedia[0]).toMatchObject({ type: "image" });
      expect(result[0].linkPreviewMedia[0].url).toContain(
        `/__images/v1/grid/${encodeURIComponent(imageKey)}`
      );
      expect(result[0].linkPreviewMedia[1]).toMatchObject({ type: "video" });
      expect(result[0].linkPreviewMedia[1].url).toContain(
        `${FILES_BASE}/${videoKey}?`
      );
      expect(result[0].linkPreviewMedia[1].posterUrl).toContain(
        `/__images/v1/grid/${encodeURIComponent(posterKey)}`
      );
    });

    test("handles null storage URLs gracefully", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Hello",
          type: "image",
          fileId: "f1",
        },
      ];
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
        storage: { getUrl: mock().mockResolvedValue(null) },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result[0].fileUrl).toBeUndefined();
    });
  });
});
