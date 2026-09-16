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

const buildQuery = (cards: any[] = []) =>
  ({
    withIndex: mock().mockImplementation(() => buildQuery(cards)),
    withSearchIndex: mock().mockImplementation(() => buildQuery(cards)),
    filter: mock().mockImplementation(() => buildQuery(cards)),
    order: mock().mockImplementation(() => buildQuery(cards)),
    take: mock().mockResolvedValue(cards),
    paginate: mock().mockResolvedValue({
      page: cards,
      isDone: true,
      continueCursor: null,
    }),
  }) as any;

const buildSearchDb = (cards: any[], cardQuery = buildQuery(cards)) => ({
  get: mock((_table: string, id: string) =>
    Promise.resolve(cards.find((card) => card._id === id) ?? null)
  ),
  query: mock((table: string) =>
    table === "cardSearchDocuments"
      ? buildQuery(cards.map((card) => ({ cardId: card._id })))
      : cardQuery
  ),
});

describe("card/getCards.ts", () => {
  let getCards: any;
  let searchCards: any;
  let searchCardsPaginated: any;

  beforeEach(async () => {
    const module = await import("../../card/getCards");
    getCards = module.getCards;
    searchCards = module.searchCards;
    searchCardsPaginated = module.searchCardsPaginated;
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

    test("uses favorites index when favoritesOnly", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, { favoritesOnly: true });
      expect(ctx.db.query).toHaveBeenCalledWith("cards");
      expect(query.withIndex).toHaveBeenCalled();
    });

    test("uses by_user_type_deleted index when type is specified", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, { type: "image" });
      expect(ctx.db.query).toHaveBeenCalledWith("cards");
      expect(query.withIndex).toHaveBeenCalledWith(
        "by_user_type_deleted",
        expect.any(Function)
      );
    });

    test("uses default limit when not specified", async () => {
      const cards: any[] = [];
      const takeMock = mock().mockResolvedValue(cards);
      const orderMock = mock().mockReturnValue({ take: takeMock });

      const query = {
        withIndex: mock().mockReturnValue({
          order: orderMock,
        }),
      } as any;

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, {});
      expect(orderMock).toHaveBeenCalledWith("desc");
      expect(takeMock).toHaveBeenCalledWith(50);
    });

    test("clamps an oversized limit to the max card limit", async () => {
      const cards: any[] = [];
      const takeMock = mock().mockResolvedValue(cards);
      const orderMock = mock().mockReturnValue({ take: takeMock });

      const query = {
        withIndex: mock().mockReturnValue({ order: orderMock }),
      } as any;

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, { limit: 100_000 });
      // SEARCH_MAX_CARD_LIMIT
      expect(takeMock).toHaveBeenCalledWith(200);
    });

    test("clamps a non-positive limit up to 1", async () => {
      const cards: any[] = [];
      const takeMock = mock().mockResolvedValue(cards);
      const orderMock = mock().mockReturnValue({ take: takeMock });

      const query = {
        withIndex: mock().mockReturnValue({ order: orderMock }),
      } as any;

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, { limit: -10 });
      expect(takeMock).toHaveBeenCalledWith(1);
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

  describe("searchCards", () => {
    test("returns empty when unauthenticated", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
      } as any);
      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {});
      expect(result).toEqual([]);
    });

    test("handles favorites keyword search", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Fav card",
          isFavorited: true,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "fav" });
      expect(result).toHaveLength(1);
      expect(query.withIndex).toHaveBeenCalledWith(
        "by_user_favorites_deleted",
        expect.any(Function)
      );
    });

    test("handles trash keyword search", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Deleted" },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "trash" });
      expect(result).toHaveLength(1);
    });

    test("deduplicates search results", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test" },
      ];
      const query = buildQuery([cards[0], cards[0]]); // Same card twice

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test" });
      expect(result).toHaveLength(1);
    });

    test("filters by type when types provided", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          type: "image",
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          content: "Test",
          type: "video",
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {
        searchQuery: "test",
        types: ["image"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("image");
    });

    test("filters by favorites when favoritesOnly is true", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          isFavorited: true,
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          content: "Test",
          isFavorited: false,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {
        searchQuery: "test",
        favoritesOnly: true,
      });
      expect(result).toHaveLength(1);
      expect(result[0].isFavorited).toBe(true);
    });

    test("filters by createdAtRange when searching", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          createdAt: 800,
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          content: "Test",
          createdAt: 950,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {
        searchQuery: "test",
        createdAtRange: { start: 900, end: 1000 },
      });
      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe("c2");
    });

    test("limits results when limit provided", async () => {
      const cards = Array.from({ length: 100 }, (_, i) => ({
        _id: `c${i}`,
        _creationTime: i,
        userId: "u1",
        content: "Test",
        createdAt: 1000 - i,
      }));
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test", limit: 10 });
      expect(result.length).toBeLessThanOrEqual(10);
    });

    test("uses by_user_type_deleted index for single type filter", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      await handler(ctx, { types: ["image"] });
      expect(query.withIndex).toHaveBeenCalledWith(
        "by_user_type_deleted",
        expect.any(Function)
      );
    });

    test("handles no search query with type filter", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", type: "image" },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { types: ["image"] });
      expect(result).toHaveLength(1);
    });

    test("uses by_created index when createdAtRange provided without searchQuery", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      await handler(ctx, {
        createdAtRange: { start: 0, end: 1000 },
      });
      expect(query.withIndex).toHaveBeenCalledWith(
        "by_created",
        expect.any(Function)
      );
    });

    test("filters by normalized visual style, hue, and hex", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Image card",
          type: "image",
          visualStyles: ["vintage"],
          colorHues: ["purple"],
          colorHexes: ["#663399"],
          createdAt: 1000,
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          content: "Palette card",
          type: "palette",
          colorHues: ["purple"],
          colorHexes: ["#663399"],
          createdAt: 900,
        },
      ];
      const query = buildQuery(cards);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {
        styleFilters: ["vintage"],
        hueFilters: ["violet"],
        hexFilters: ["663399"],
      });

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe("c1");
      expect(query.withSearchIndex).toHaveBeenCalled();
    });

    test("throws for invalid hex filters", async () => {
      const query = buildQuery([]);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      await expect(
        handler(ctx, {
          hexFilters: ["not-a-hex"],
        })
      ).rejects.toThrow("Invalid hexFilters");
    });
  });

  describe("searchCardsPaginated", () => {
    test("returns empty pagination when unauthenticated", async () => {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue(null) },
      } as any);
      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(result).toEqual({ page: [], isDone: true, continueCursor: null });
    });

    test("paginates favorites search", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Fav",
          isFavorited: true,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
        searchQuery: "favorites",
      });
      expect(result.page).toHaveLength(1);
    });

    test("paginates trash search", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Deleted" },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
        searchQuery: "deleted",
      });
      expect(result.page).toHaveLength(1);
    });

    test("returns continueCursor when more results exist", async () => {
      const cards = Array.from({ length: 20 }, (_, i) => ({
        _id: `c${i}`,
        _creationTime: i,
        userId: "u1",
        content: "Test",
        createdAt: 1000 - i,
      }));
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
      });
      expect(result.continueCursor).toBe("10");
    });

    test("returns null continueCursor when done", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          createdAt: 1000,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
      });
      expect(result.continueCursor).toBeNull();
    });

    test("filters by type in search", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          type: "image",
          createdAt: 1000,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
        types: ["image"],
      });
      expect(result.page).toHaveLength(1);
    });

    test("filters by createdAtRange in paginated search", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Test",
          createdAt: 500,
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          content: "Test",
          createdAt: 900,
        },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
        createdAtRange: { start: 800, end: 1000 },
      });
      expect(result.page).toHaveLength(1);
      expect(result.page[0]._id).toBe("c2");
    });

    test("paginates without search query", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test" },
      ];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(result.page).toHaveLength(1);
    });

    test("clamps an oversized numItems before paginating", async () => {
      const paginateMock = mock().mockResolvedValue({
        page: [],
        isDone: true,
        continueCursor: null,
      });
      const query = {
        withIndex: mock().mockReturnThis(),
        withSearchIndex: mock().mockReturnThis(),
        filter: mock().mockReturnThis(),
        order: mock().mockReturnThis(),
        take: mock().mockResolvedValue([]),
        paginate: paginateMock,
      } as any;

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      await handler(ctx, {
        paginationOpts: { numItems: 100_000, cursor: null },
      });

      expect(paginateMock).toHaveBeenCalledWith(
        // SEARCH_MAX_PAGE_SIZE
        expect.objectContaining({ numItems: 100 })
      );
    });

    test("treats a deep/garbage cursor as a clamped offset", async () => {
      const cards = Array.from({ length: 5 }, (_, i) => ({
        _id: `c${i}`,
        _creationTime: i,
        userId: "u1",
        content: "Test",
        createdAt: 1000 - i,
      }));
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: buildSearchDb(cards, query),
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      // A cursor far beyond SEARCH_MAX_OFFSET must not throw or over-read.
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "999999999" },
        searchQuery: "test",
      });
      expect(Array.isArray(result.page)).toBe(true);
    });

    test("uses by_created index when createdAtRange provided without searchQuery", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
        createdAtRange: { start: 0, end: 1000 },
      });
      expect(query.withIndex).toHaveBeenCalledWith(
        "by_created",
        expect.any(Function)
      );
    });

    test("applies normalized hue and hex filters in paginated mode", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          type: "image",
          colorHues: ["blue"],
          colorHexes: ["#1E90FF"],
          createdAt: 1000,
        },
        {
          _id: "c2",
          _creationTime: 2,
          userId: "u1",
          type: "palette",
          colorHues: ["blue"],
          colorHexes: ["#1E90FF"],
          createdAt: 900,
        },
      ];
      const query = buildQuery(cards);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        hueFilters: ["blue"],
        hexFilters: ["1e90ff"],
      });

      expect(result.page).toHaveLength(2);
      expect(query.withSearchIndex).toHaveBeenCalled();
    });

    test("throws for invalid hex filters in paginated mode", async () => {
      const query = buildQuery([]);
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any);

      const handler =
        (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      await expect(
        handler(ctx, {
          paginationOpts: { numItems: 10, cursor: "0" },
          hexFilters: ["definitely-invalid"],
        })
      ).rejects.toThrow("Invalid hexFilters");
    });
  });
});
