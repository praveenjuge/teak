// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

const buildQuery = (cards: any[] = []) => {
  return {
    withIndex: mock().mockImplementation(() => buildQuery(cards)),
    withSearchIndex: mock().mockImplementation(() => buildQuery(cards)),
    filter: mock().mockImplementation(() => buildQuery(cards)),
    order: mock().mockImplementation(() => buildQuery(cards)),
    take: mock().mockResolvedValue(cards),
    paginate: mock().mockResolvedValue({ page: cards, isDone: true, continueCursor: null }),
  } as any;
};

describe("card/getCards.ts", () => {
  let getCards: any;
  let searchCards: any;
  let searchCardsPaginated: any;

  beforeEach(async () => {
    const module = await import("../../../convex/card/getCards");
    getCards = module.getCards;
    searchCards = module.searchCards;
    searchCardsPaginated = module.searchCardsPaginated;
  });

  describe("getCards", () => {
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

    test("uses by_user_type_deleted index when type is specified", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, { type: "image" });
      expect(ctx.db.query).toHaveBeenCalledWith("cards");
      expect(query.withIndex).toHaveBeenCalledWith("by_user_type_deleted", expect.any(Function));
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

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (getCards as any).handler ?? getCards;
      await handler(ctx, {});
      expect(orderMock).toHaveBeenCalledWith("desc");
      expect(takeMock).toHaveBeenCalledWith(50);
    });

    test("attaches linkPreviewImageUrl from metadata", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Hello",
          type: "link",
          metadata: { linkPreview: { imageStorageId: "img1" } },
        },
      ];
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
        storage: { getUrl: mock().mockResolvedValue("file://img1") },
      } as any;

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result[0].linkPreviewImageUrl).toBe("file://img1");
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
      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(buildQuery(cards)) },
        storage: { getUrl: mock().mockResolvedValue(null) },
      } as any;

      const handler = (getCards as any).handler ?? getCards;
      const result = await handler(ctx, {});
      expect(result[0].fileUrl).toBeUndefined();
    });
  });

  describe("searchCards", () => {
    test("returns empty when unauthenticated", async () => {
      const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, {});
      expect(result).toEqual([]);
    });

    test("handles favorites keyword search", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Fav card" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "fav" });
      expect(result).toHaveLength(1);
      expect(query.withIndex).toHaveBeenCalledWith("by_user_favorites_deleted", expect.any(Function));
    });

    test("handles trash keyword search", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Deleted" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "trash" });
      expect(result).toHaveLength(1);
    });

    test("deduplicates search results", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Test" }];
      const query = buildQuery([cards[0], cards[0]]); // Same card twice

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test" });
      expect(result).toHaveLength(1);
    });

    test("filters by type when types provided", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test", type: "image" },
        { _id: "c2", _creationTime: 2, userId: "u1", content: "Test", type: "video" },
      ];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test", types: ["image"] });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("image");
    });

    test("filters by favorites when favoritesOnly is true", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test", isFavorited: true },
        { _id: "c2", _creationTime: 2, userId: "u1", content: "Test", isFavorited: false },
      ];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test", favoritesOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0].isFavorited).toBe(true);
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

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "test", limit: 10 });
      expect(result.length).toBeLessThanOrEqual(10);
    });

    test("uses by_user_type_deleted index for single type filter", async () => {
      const cards: any[] = [];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      await handler(ctx, { types: ["image"] });
      expect(query.withIndex).toHaveBeenCalledWith("by_user_type_deleted", expect.any(Function));
    });

    test("handles no search query with type filter", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", type: "image" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { types: ["image"] });
      expect(result).toHaveLength(1);
    });
  });

  describe("searchCardsPaginated", () => {
    test("returns empty pagination when unauthenticated", async () => {
      const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, { paginationOpts: { numItems: 10, cursor: null } });
      expect(result).toEqual({ page: [], isDone: true, continueCursor: null });
    });

    test("paginates favorites search", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Fav" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
        searchQuery: "favorites",
      });
      expect(result.page).toHaveLength(1);
    });

    test("paginates trash search", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Deleted" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
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

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
      });
      expect(result.continueCursor).toBe("10");
    });

    test("returns null continueCursor when done", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Test", createdAt: 1000 }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
      });
      expect(result.continueCursor).toBeNull();
    });

    test("filters by type in search", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test", type: "image", createdAt: 1000 },
      ];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "0" },
        searchQuery: "test",
        types: ["image"],
      });
      expect(result.page).toHaveLength(1);
    });

    test("paginates without search query", async () => {
      const cards = [{ _id: "c1", _creationTime: 1, userId: "u1", content: "Test" }];
      const query = buildQuery(cards);

      const ctx = {
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(query) },
        storage: { getUrl: mock() },
      } as any;

      const handler = (searchCardsPaginated as any).handler ?? searchCardsPaginated;
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(result.page).toHaveLength(1);
    });
  });
});
