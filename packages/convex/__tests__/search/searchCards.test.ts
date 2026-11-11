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

const buildSearchDb = (cards: any[], cardQuery = buildQuery(cards)) => ({
  get: mock((_table: string, id: string) =>
    Promise.resolve(cards.find((card) => card._id === id) ?? null)
  ),
  query: mock((table: string) => {
    if (table === "cardSearchDocuments") {
      return buildQuery(
        cards.map((card) => ({
          cardId: card._id,
          cardCreatedAt: card.createdAt,
          cardCreationTime: card._creationTime,
          type: card.type,
          userId: card.userId,
          searchableText: card.content ?? "",
        }))
      );
    }
    return table === "semanticSearchResults" ? buildQuery([]) : cardQuery;
  }),
});

describe("search/searchCards.ts", () => {
  let searchCards: any;
  let searchCardsPaginated: any;

  beforeEach(async () => {
    const module = await import("../../search/searchCards");
    searchCards = module.searchCards;
    searchCardsPaginated = module.searchCardsPaginated;
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

    test("handles trash keyword search", async () => {
      const cards = [
        {
          _id: "c1",
          _creationTime: 1,
          userId: "u1",
          content: "Deleted",
          isDeleted: true,
        },
        { _id: "c2", _creationTime: 2, userId: "u1", content: "Kept" },
      ];

      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: { query: mock().mockReturnValue(indexedQuery(cards)) },
        storage: { getUrl: mock() },
      } as any);

      const handler = (searchCards as any).handler ?? searchCards;
      const result = await handler(ctx, { searchQuery: "trash" });
      expect(result.map((card: { _id: string }) => card._id)).toEqual(["c1"]);
    });

    test("deduplicates search results", async () => {
      const cards = [
        { _id: "c1", _creationTime: 1, userId: "u1", content: "Test" },
      ];
      const query = buildQuery([cards[0], cards[0]]);

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
      const result = await handler(ctx, {
        paginationOpts: { numItems: 10, cursor: "999999999" },
        searchQuery: "test",
      });
      expect(Array.isArray(result.page)).toBe(true);
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
