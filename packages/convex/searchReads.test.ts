import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { CARD_LIST_PAGE_ROW_LIMIT } from "./card/listQuery";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type CardSeed = Partial<Omit<Doc<"cards">, "_id" | "_creationTime">>;

const SEED_BATCH = 10;

const setup = async (documentsRead?: number) => {
  const t = convexTest({
    schema,
    modules,
    ...(documentsRead ? { transactionLimits: { documentsRead } } : {}),
  });
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_searchreads",
    email_verified: true,
    external_id: "owner",
  });

  let nextCreatedAt = 1000;
  const cardOf = (seed: CardSeed) => {
    nextCreatedAt += 1;
    return {
      userId: "owner",
      type: "text" as const,
      content: `Card ${nextCreatedAt}`,
      createdAt: nextCreatedAt,
      updatedAt: nextCreatedAt,
      shuffleKey: ((nextCreatedAt * 7919) % 1009) / 1009,
      ...seed,
    };
  };
  const insertAll = async (
    seeds: readonly CardSeed[],
    options: { sync?: boolean } = {}
  ): Promise<Id<"cards">[]> => {
    const ids: Id<"cards">[] = [];
    const batch = options.sync === false ? 500 : SEED_BATCH;
    for (let start = 0; start < seeds.length; start += batch) {
      const cards = seeds.slice(start, start + batch).map(cardOf);
      ids.push(
        ...(await t.run(async (ctx) => {
          const inserted: Id<"cards">[] = [];
          for (const card of cards) {
            const id = await ctx.db.insert("cards", card);
            if (options.sync !== false) {
              await syncCardSearchDocumentHandler(ctx, id);
            }
            inserted.push(id);
          }
          return inserted;
        }))
      );
    }
    return ids;
  };
  const insert = async (seed: CardSeed) => (await insertAll([seed]))[0];

  const readPages = async (
    args: Record<string, unknown>,
    numItems = 3,
    query: typeof api.cards.searchCardsPaginated = api.cards
      .searchCardsPaginated
  ) => {
    const pages: { ids: string[]; continueCursor: string | null }[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 400; index += 1) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: { _id: string }[];
      } = await owner.query(query, {
        ...args,
        paginationOpts: { numItems, cursor },
      });
      pages.push({
        ids: result.page.map((card) => card._id),
        continueCursor: result.continueCursor,
      });
      if (result.isDone || !result.continueCursor) {
        return pages;
      }
      cursor = result.continueCursor;
    }
    throw new Error("read did not finish");
  };
  const readAll = async (
    args: Record<string, unknown>,
    numItems = 3,
    query?: typeof api.cards.searchCardsPaginated
  ) => (await readPages(args, numItems, query)).flatMap((page) => page.ids);

  const searchDocuments = () =>
    t.run((ctx) => ctx.db.query("cardSearchDocuments").collect());
  const forgetStoredDates = () =>
    t.run(async (ctx: MutationCtx) => {
      for (const document of await ctx.db
        .query("cardSearchDocuments")
        .collect()) {
        await ctx.db.patch("cardSearchDocuments", document._id, {
          cardCreatedAt: undefined,
          cardCreationTime: undefined,
        });
      }
    });

  return {
    t,
    owner,
    insert,
    insertAll,
    readPages,
    readAll,
    searchDocuments,
    forgetStoredDates,
  };
};

const searches: [string, Record<string, unknown>][] = [
  ["newest", { searchQuery: "kestrel" }],
  ["oldest", { searchQuery: "kestrel", sort: "oldest" }],
  ["shuffled", { searchQuery: "kestrel", sort: "shuffle", shuffleSeed: 7 }],
  ["favourites", { searchQuery: "kestrel", favoritesOnly: true }],
  ["a phrase", { searchQuery: 'kestrel "blue heron"' }],
  [
    "a date range",
    { searchQuery: "kestrel", createdAtRange: { start: 1004, end: 1012 } },
  ],
  ["the archive", { searchQuery: "kestrel", showArchivedOnly: true }],
  ["trash", { searchQuery: "kestrel", showTrashOnly: true }],
  ["relevance", { searchQuery: "kestrel", mode: "keyword", sort: "relevance" }],
];

describe("text search pages", () => {
  test("rank matches from search documents in the order loaded cards give", async () => {
    const { insertAll, readAll } = await setup();
    // Every card is a red image, so a hue filter (which loads every card)
    // returns the same matches as the document-ranked read.
    const image = (seed: CardSeed): CardSeed => ({
      type: "image",
      colorHues: ["red"],
      ...seed,
    });
    await insertAll([
      image({ content: "kestrel one" }),
      image({ content: "kestrel two blue heron", isFavorited: true }),
      image({ content: "sparrow only" }),
      image({ content: "kestrel hidden", tags: ["hidden"] }),
      image({ content: "kestrel archived", isArchived: true }),
      image({ content: "kestrel trashed", isDeleted: true, deletedAt: 1 }),
      image({ content: "kestrel three", createdAt: 1003 }),
      image({ content: "kestrel four blue heron", createdAt: 1003 }),
      image({ content: "kestrel five", createdAt: 1003, isFavorited: true }),
      ...Array.from({ length: 8 }, (_, index) =>
        image({ content: `kestrel more ${index}` })
      ),
    ]);

    for (const [name, args] of searches) {
      const fromDocuments = await readAll(args);
      const fromCards = await readAll({ ...args, hueFilters: ["red"] });
      expect(fromDocuments, name).toEqual(fromCards);
    }
    expect(await readAll({ searchQuery: "kestrel" })).toHaveLength(13);
  });

  test("give the same pages before and after search documents store card dates", async () => {
    const {
      t,
      insert,
      insertAll,
      readAll,
      searchDocuments,
      forgetStoredDates,
    } = await setup();
    await insertAll([
      { content: "kestrel note" },
      { content: "kestrel tie a", createdAt: 1001 },
      { content: "kestrel tie b", createdAt: 1001 },
      { type: "link", url: "https://example.com/a", content: "kestrel link" },
      {
        type: "link",
        url: "https://other.test/b",
        content: "kestrel elsewhere",
      },
      { content: "kestrel favourite blue heron", isFavorited: true },
      { content: "kestrel archived", isArchived: true },
      { content: "kestrel hidden", tags: ["secret"] },
    ]);
    const pdf = await insert({
      type: "document",
      content: "",
      fileKey: "users/owner/cards/c/file/report.pdf",
      fileMetadata: { fileName: "report.pdf", mimeType: "application/pdf" },
    });
    await t.run((ctx) =>
      ctx.db.insert("cardTextContents", {
        cardId: pdf,
        userId: "owner",
        kind: "document",
        text: "The Kestrel Freight agreement",
        sourceKey: "users/owner/cards/c/text/report.txt",
        charCount: 29,
        truncated: false,
      })
    );
    const all: [string, Record<string, unknown>][] = [
      ...searches,
      ["two types", { searchQuery: "kestrel", types: ["link", "document"] }],
      ["a site", { searchQuery: "kestrel site:example.com" }],
      [
        "two sites",
        { searchQuery: "kestrel site:example.com site:other.test" },
      ],
      ["hidden", { searchQuery: "kestrel tag:hidden" }],
    ];

    expect(
      (await searchDocuments()).every(
        (document) =>
          document.cardCreatedAt !== undefined &&
          document.cardCreationTime !== undefined
      )
    ).toBe(true);
    const withDates = new Map<string, string[]>();
    for (const [name, args] of all) {
      withDates.set(name, await readAll(args));
    }
    expect(withDates.get("newest")).toContain(pdf);
    expect(withDates.get("two types")).toContain(pdf);

    await forgetStoredDates();
    for (const [name, args] of all) {
      expect(await readAll(args), name).toEqual(withDates.get(name));
    }

    const dryRun = await t.mutation(
      internal["migration/backfillSearchDocumentDates"]
        .backfillSearchDocumentDates,
      { once: true }
    );
    expect(dryRun.batch.searchDocumentsToUpdate).toBe(
      (await searchDocuments()).length
    );
    expect(
      (await searchDocuments()).every(
        (document) => document.cardCreatedAt === undefined
      )
    ).toBe(true);

    await t.mutation(
      internal["migration/backfillSearchDocumentDates"]
        .backfillSearchDocumentDates,
      { dryRun: false, once: true }
    );
    const cards = await t.run((ctx) => ctx.db.query("cards").collect());
    const documents = await searchDocuments();
    expect(documents).toHaveLength(cards.length);
    for (const document of documents) {
      const card = cards.find((item) => item._id === document.cardId);
      expect(document.cardCreatedAt).toBe(card?.createdAt);
      expect(document.cardCreationTime).toBe(card?._creationTime);
    }
    for (const [name, args] of all) {
      expect(await readAll(args), name).toEqual(withDates.get(name));
    }
  });

  test("a page loads its own cards, not every match", async () => {
    const { insertAll, readPages } = await setup(450);
    await insertAll(
      Array.from({ length: 300 }, (_, index) => ({
        content: `kestrel ${index}`,
      }))
    );

    const pages = await readPages({ searchQuery: "kestrel" }, 50);

    expect(pages.flatMap((page) => page.ids)).toHaveLength(300);
  }, 300_000);
});

describe("card lists", () => {
  test("a list of several types returns the newest of those types", async () => {
    const { insertAll, owner } = await setup();
    const older = await insertAll(
      [
        { type: "link", url: "https://example.com/1" },
        { type: "image" },
        { type: "link", url: "https://example.com/2" },
        { type: "image", isArchived: true },
        { type: "image" },
      ],
      { sync: false }
    );
    await insertAll(
      Array.from({ length: 300 }, () => ({})),
      { sync: false }
    );

    const cards = await owner.query(api.cards.searchCards, {
      types: ["link", "image"],
      limit: 3,
    });

    expect(cards.map((card: { _id: string }) => card._id)).toEqual([
      older[4],
      older[2],
      older[1],
    ]);
  }, 300_000);

  test("a page stops at the row cap past hidden cards, and later pages finish the list", async () => {
    const { insertAll, readPages } = await setup();
    const visible = await insertAll(
      [{ content: "one" }, { content: "two" }, { content: "three" }],
      { sync: false }
    );
    await insertAll(
      Array.from({ length: CARD_LIST_PAGE_ROW_LIMIT + 200 }, () => ({
        tags: ["hidden"],
        isHidden: true as const,
      })),
      { sync: false }
    );

    const pages = await readPages({}, 30);

    expect(pages[0]?.ids).toEqual([]);
    expect(pages[0]?.continueCursor).not.toBeNull();
    expect(pages.flatMap((page) => page.ids)).toEqual([...visible].reverse());
  }, 300_000);
});

describe("shuffle walks", () => {
  const segmentOf = (cursor: string | null) =>
    cursor ? (JSON.parse(cursor) as { segment: number }).segment : null;

  test("a single type or favourites fill every page that doesn't end a segment", async () => {
    const { insertAll, readPages, readAll } = await setup();
    const links = await insertAll(
      Array.from({ length: 8 }, (_, index) => ({
        type: "link" as const,
        url: `https://example.com/${index}`,
        isFavorited: index % 2 === 0 ? (true as const) : undefined,
      })),
      { sync: false }
    );
    await insertAll(
      Array.from({ length: 3000 }, () => ({})),
      { sync: false }
    );

    for (const filter of [{ types: ["link"] }, { favoritesOnly: true }]) {
      const args = { ...filter, sort: "shuffle", shuffleSeed: 11 };
      const pages = await readPages(args, 2);
      let cursor: string | null = null;
      for (const page of pages) {
        const endsSegment =
          page.continueCursor === null ||
          segmentOf(page.continueCursor) !== segmentOf(cursor);
        if (!endsSegment) {
          expect(page.ids).toHaveLength(2);
        }
        cursor = page.continueCursor;
      }
      const everything = await readAll(
        { sort: "shuffle", shuffleSeed: 11 },
        500
      );
      const wanted = new Set(
        "types" in filter ? links : links.filter((_, index) => index % 2 === 0)
      );
      expect(pages.flatMap((page) => page.ids)).toEqual(
        everything.filter((id) => wanted.has(id as Id<"cards">))
      );
    }
  }, 300_000);
});
