import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content" | "createdAt" | "type"> &
  Partial<
    Pick<
      Doc<"cards">,
      "isArchived" | "isDeleted" | "isFavorited" | "tags" | "url" | "urlHost"
    >
  > & {
    /** Defaults to `createdAt`; `null` for a row from before `savedAt`. */
    savedAt?: number | null;
    inFolder?: true;
  };

const LIBRARY: CardSeed[] = [
  { content: "Newest note", type: "text", createdAt: 3000 },
  { content: "Middle note", type: "text", createdAt: 2000 },
  { content: "Imported note", type: "text", createdAt: 1000 },
];

const setup = async (cards: CardSeed[] = LIBRARY) => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const folderId = await t.run((ctx) =>
    ctx.db.insert("folders", {
      userId: "owner",
      name: "Reading",
      nameKey: "reading",
      kind: "manual",
      activeCardCount: 0,
      createdAt: 1,
      updatedAt: 1,
    })
  );
  const ids = new Map<string, Id<"cards">>();
  for (const { savedAt, inFolder, ...card } of cards) {
    const id = await t.run(async (ctx) => {
      const cardId = await ctx.db.insert("cards", {
        userId: "owner",
        ...card,
        ...(savedAt === null ? {} : { savedAt: savedAt ?? card.createdAt }),
        ...(inFolder ? { folderIds: [folderId] } : {}),
        updatedAt: Math.max(card.createdAt, savedAt ?? 0),
      });
      await syncCardSearchDocumentHandler(ctx, cardId);
      return cardId;
    });
    ids.set(card.content, id);
  }
  // Tag rows are written by a scheduled sync.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_ordering",
    email_verified: true,
    external_id: "owner",
  });
  return { t, owner, ids, folderId };
};

type Owner = Awaited<ReturnType<typeof setup>>["owner"];

const contents = (cards: { content: string }[]) =>
  cards.map((card) => card.content);

const readAllPages = async (
  owner: Owner,
  args: Record<string, unknown> = {}
): Promise<string[]> => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 20; index += 1) {
    const page: {
      continueCursor: string | null;
      isDone: boolean;
      page: { content: string }[];
    } = await owner.query(api.cards.searchCardsPaginated, {
      ...args,
      paginationOpts: { numItems: 1, cursor },
    });
    seen.push(...contents(page.page));
    if (page.isDone) {
      return seen;
    }
    cursor = page.continueCursor;
  }
  throw new Error("pagination did not finish");
};

describe("library order follows the saved date", () => {
  test("an imported card sorts by when it was saved, newest first by default", async () => {
    const { owner } = await setup();
    expect(await readAllPages(owner)).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
  });

  test("oldest first reverses the order", async () => {
    const { owner } = await setup();
    expect(await readAllPages(owner, { sort: "oldest" })).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test.each([
    ["one type", { types: ["text"] }],
    ["several types", { types: ["text", "link"] }],
    ["favorites", { favoritesOnly: true }],
    ["a date range", { createdAtRange: { start: 0, end: 10_000 } }],
  ])("%s keeps the same order", async (_label, filters) => {
    const { owner } = await setup(
      LIBRARY.map((card) => ({ ...card, isFavorited: true }))
    );
    expect(await readAllPages(owner, filters)).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readAllPages(owner, { ...filters, sort: "oldest" })).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("Trash orders by saved date too", async () => {
    const { owner } = await setup(
      LIBRARY.map((card) => ({ ...card, isDeleted: true }))
    );
    expect(await readAllPages(owner, { showTrashOnly: true })).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readAllPages(owner, { searchQuery: "trash" })).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
  });

  test("text search honors the sort", async () => {
    const { owner } = await setup();
    const search = async (sort: "newest" | "oldest") =>
      contents(
        (
          await owner.query(api.cards.searchCardsPaginated, {
            searchQuery: "note",
            sort,
            paginationOpts: { numItems: 10, cursor: null },
          })
        ).page
      );
    expect(await search("newest")).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await search("oldest")).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("cards saved at the same moment page once each, in a stable order", async () => {
    const { owner } = await setup([
      { content: "Twin A", type: "text", createdAt: 5000 },
      { content: "Twin B", type: "text", createdAt: 5000 },
      { content: "Twin C", type: "text", createdAt: 5000 },
    ]);
    const newest = await readAllPages(owner);
    const oldest = await readAllPages(owner, { sort: "oldest" });
    expect(new Set(newest).size).toBe(3);
    expect(newest).toEqual(["Twin C", "Twin B", "Twin A"]);
    expect(oldest).toEqual(["Twin A", "Twin B", "Twin C"]);
  });

  test("archived cards stay out of the library but deleted ones reach Trash", async () => {
    const { owner } = await setup([
      { content: "Kept", type: "text", createdAt: 3000 },
      { content: "Archived", type: "text", createdAt: 2000, isArchived: true },
      {
        content: "Archived then trashed",
        type: "text",
        createdAt: 1000,
        isArchived: true,
        isDeleted: true,
      },
    ]);
    expect(await readAllPages(owner)).toEqual(["Kept"]);
    expect(await readAllPages(owner, { showTrashOnly: true })).toEqual([
      "Archived then trashed",
    ]);
  });

  test("the mobile summaries keep their shape and the same order", async () => {
    const { owner, ids } = await setup();
    const page = await owner.query(
      api.cards.searchMobileCardSummariesPaginated,
      { sort: "oldest", paginationOpts: { numItems: 10, cursor: null } }
    );
    expect(page.page.map((card: { _id: string }) => card._id)).toEqual([
      ids.get("Imported note"),
      ids.get("Middle note"),
      ids.get("Newest note"),
    ]);
    expect(Object.keys(page.page[0] ?? {})).not.toContain("content");
  });
});

describe("public API and Raycast order", () => {
  const readApiPages = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    sort: "newest" | "oldest"
  ) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 20; index += 1) {
      const page = await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        sort,
        scanLimit: 1,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...contents(page.items));
      const next = page.itemCursors.at(-1) ?? page.nextCursor;
      if (!(next && page.nextCursor)) {
        return seen;
      }
      cursor = next;
    }
    throw new Error("pagination did not finish");
  };

  test("GET /v1/cards pages by saved date in both directions", async () => {
    const { t } = await setup();
    expect(await readApiPages(t, "newest")).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readApiPages(t, "oldest")).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("a cursor from the old insertion-order index is refused as invalid input", async () => {
    const { t } = await setup();
    const legacy = btoa(
      JSON.stringify({ mode: "index", cursor: null, pageOffset: 0 })
    );
    await expect(
      t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        cursor: legacy,
        scanLimit: 10,
      })
    ).rejects.toThrow("`cursor` is invalid");
  });
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24);

// By `createdAt` these read Newest, Middle, Resaved; by `savedAt` (what
// every date-ordered list follows) Resaved, Newest, Middle.
const resavedLibrary = (extra: Partial<CardSeed> = {}): CardSeed[] =>
  [
    { content: "Middle note", createdAt: NOW - 60 * DAY },
    {
      content: "Resaved note",
      createdAt: NOW - 400 * DAY,
      savedAt: NOW - DAY,
    },
    { content: "Newest note", createdAt: NOW - 30 * DAY },
  ].map(
    (card, index): CardSeed => ({
      type: "link",
      url: `https://example.com/${index}`,
      urlHost: "example.com",
      tags: ["reading"],
      isFavorited: true,
      inFolder: true,
      ...card,
      ...extra,
    })
  );

const SAVED_NEWEST = ["Resaved note", "Newest note", "Middle note"];
const SAVED_OLDEST = ["Middle note", "Newest note", "Resaved note"];

type Setup = Awaited<ReturnType<typeof setup>>;

const webPaths = (folderId: Id<"folders">) =>
  [
    ["the library", {}],
    ["one type", { types: ["link"] }],
    ["several types", { types: ["link", "text"] }],
    ["favorites", { favoritesOnly: true }],
    ["a site", { searchQuery: "site:example.com" }],
    ["a folder", { folderId }],
    ["a tag", { tag: "reading" }],
    ["a tag and a type", { tag: "reading", types: ["link"] }],
    ["a tag and favorites", { tag: "reading", favoritesOnly: true }],
    [
      "a tag, a type and favorites",
      { tag: "reading", types: ["link"], favoritesOnly: true },
    ],
    [
      "a date word",
      { createdAtRange: { start: NOW - 365 * DAY, end: NOW + DAY } },
    ],
    ["a text search", { searchQuery: "note" }],
  ] as [string, Record<string, unknown>][];

describe("a card saved again moves by its saved date", () => {
  test("every web list path puts it first in Newest and last in Oldest", async () => {
    const { owner, folderId } = await setup(resavedLibrary());
    for (const [label, args] of webPaths(folderId)) {
      expect({ label, order: await readAllPages(owner, args) }).toEqual({
        label,
        order: SAVED_NEWEST,
      });
      expect({
        label,
        order: await readAllPages(owner, { ...args, sort: "oldest" }),
      }).toEqual({ label, order: SAVED_OLDEST });
    }
  });

  test("Archive, the archived folder view, archived tags and sites follow it too", async () => {
    const { owner, folderId } = await setup(
      resavedLibrary({ isArchived: true })
    );
    for (const args of [
      { showArchivedOnly: true },
      { showArchivedOnly: true, folderId },
      { showArchivedOnly: true, tag: "reading" },
      { showArchivedOnly: true, tag: "reading", types: ["link"] },
      { showArchivedOnly: true, favoritesOnly: true },
      { showArchivedOnly: true, searchQuery: "site:example.com" },
    ]) {
      expect(await readAllPages(owner, args)).toEqual(SAVED_NEWEST);
      expect(await readAllPages(owner, { ...args, sort: "oldest" })).toEqual(
        SAVED_OLDEST
      );
    }
  });

  test("Trash follows it too", async () => {
    const { owner } = await setup(resavedLibrary({ isDeleted: true }));
    expect(await readAllPages(owner, { showTrashOnly: true })).toEqual(
      SAVED_NEWEST
    );
    expect(
      await readAllPages(owner, { showTrashOnly: true, sort: "oldest" })
    ).toEqual(SAVED_OLDEST);
  });

  test("last week finds a card first saved last year but saved again yesterday", async () => {
    const { owner, folderId } = await setup(resavedLibrary());
    const lastWeek = { start: NOW - 7 * DAY, end: NOW };
    for (const [label, args] of webPaths(folderId)) {
      if ("createdAtRange" in args) {
        continue;
      }
      expect({
        label,
        found: await readAllPages(owner, {
          ...args,
          createdAtRange: lastWeek,
        }),
      }).toEqual({ label, found: ["Resaved note"] });
    }
    for (const sort of ["newest", "oldest", "shuffle"] as const) {
      expect(
        await readAllPages(owner, { createdAtRange: lastWeek, sort })
      ).toEqual(["Resaved note"]);
    }
  });

  test("the plain list queries order by it", async () => {
    const { owner } = await setup(resavedLibrary());
    expect(contents(await owner.query(api.cards.getCards, {}))).toEqual(
      SAVED_NEWEST
    );
    const cases: [Record<string, unknown>, string[]][] = [
      [{}, SAVED_NEWEST],
      [{ sort: "oldest" }, SAVED_OLDEST],
      [{ searchQuery: "note", sort: "oldest" }, SAVED_OLDEST],
      [{ searchQuery: "favorites" }, SAVED_NEWEST],
      [
        { createdAtRange: { start: NOW - 7 * DAY, end: NOW } },
        ["Resaved note"],
      ],
    ];
    for (const [args, expected] of cases) {
      expect(contents(await owner.query(api.cards.searchCards, args))).toEqual(
        expected
      );
    }
  });
});

const readApiCards = async (
  t: Setup["t"],
  args: Record<string, unknown>
): Promise<string[]> => {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < 20; index += 1) {
    const page = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      scanLimit: 1,
      ...args,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...contents(page.items));
    const next = page.itemCursors.at(-1) ?? page.nextCursor;
    if (!(next && page.nextCursor)) {
      return seen;
    }
    cursor = next;
  }
  throw new Error("pagination did not finish");
};

const searchApiCards = async (
  t: Setup["t"],
  args: Record<string, unknown>
): Promise<string[]> => {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < 20; index += 1) {
    const page = await t.query(internal.publicApi.searchCardsPageForUser, {
      userId: "owner",
      limit: 1,
      ...args,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...contents(page.items));
    if (!page.pageInfo.nextCursor) {
      return seen;
    }
    cursor = page.pageInfo.nextCursor;
  }
  throw new Error("pagination did not finish");
};

describe("GET /v1/cards follows the saved date", () => {
  test("sort=newest|oldest, by folder, site, tag and text, puts a card saved again first", async () => {
    const { t, folderId } = await setup(resavedLibrary());
    const paths: [typeof readApiCards, Record<string, unknown>][] = [
      [readApiCards, {}],
      [readApiCards, { type: "link" }],
      [readApiCards, { favorited: true }],
      [readApiCards, { folderId }],
      [readApiCards, { sites: ["example.com"] }],
      [readApiCards, { createdAfter: NOW - 365 * DAY }],
      [searchApiCards, { tag: "reading" }],
      [searchApiCards, { searchQuery: "note" }],
    ];
    for (const [read, args] of paths) {
      expect({
        args,
        order: await read(t, { ...args, sort: "newest" }),
      }).toEqual({ args, order: SAVED_NEWEST });
      expect({
        args,
        order: await read(t, { ...args, sort: "oldest" }),
      }).toEqual({ args, order: SAVED_OLDEST });
    }
  });

  test("createdAfter and createdBefore bound the saved date", async () => {
    const { t, folderId } = await setup(resavedLibrary());
    const lastWeek = { createdAfter: NOW - 7 * DAY, createdBefore: NOW };
    const paths: [typeof readApiCards, Record<string, unknown>][] = [
      [readApiCards, {}],
      [readApiCards, { folderId }],
      [readApiCards, { sites: ["example.com"] }],
      [searchApiCards, { tag: "reading" }],
      [searchApiCards, { searchQuery: "note" }],
    ];
    for (const [read, args] of paths) {
      expect({ args, found: await read(t, { ...args, ...lastWeek }) }).toEqual({
        args,
        found: ["Resaved note"],
      });
    }
  });
});

describe("a row from before savedAt falls back to createdAt", () => {
  // Its card and search document carry no saved date, as rows did before
  // the backfill; text search orders and filters it by `createdAt`.
  const withLegacy = async () => {
    const context = await setup([
      ...resavedLibrary(),
      {
        content: "Legacy note",
        type: "text",
        createdAt: NOW - 10 * DAY,
        savedAt: null,
      },
    ]);
    await context.t.run(async (ctx) => {
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) =>
          q.eq("cardId", context.ids.get("Legacy note") as Id<"cards">)
        )
        .unique();
      if (document) {
        await ctx.db.patch("cardSearchDocuments", document._id, {
          cardSavedAt: undefined,
        });
      }
    });
    return context;
  };
  const LEGACY_NEWEST = [
    "Resaved note",
    "Legacy note",
    "Newest note",
    "Middle note",
  ];

  test("in text search on the web and the API", async () => {
    const { t, owner } = await withLegacy();
    expect(await readAllPages(owner, { searchQuery: "note" })).toEqual(
      LEGACY_NEWEST
    );
    expect(
      await readAllPages(owner, { searchQuery: "note", sort: "oldest" })
    ).toEqual([...LEGACY_NEWEST].reverse());
    expect(
      await searchApiCards(t, { searchQuery: "note", sort: "newest" })
    ).toEqual(LEGACY_NEWEST);
    expect(
      contents(
        await owner.query(api.cards.searchCards, { searchQuery: "note" })
      )
    ).toEqual(LEGACY_NEWEST);
  });

  test("in date words", async () => {
    const { t, owner } = await withLegacy();
    const twoWeeks = { start: NOW - 14 * DAY, end: NOW };
    expect(
      await readAllPages(owner, {
        searchQuery: "note",
        createdAtRange: twoWeeks,
      })
    ).toEqual(["Resaved note", "Legacy note"]);
    expect(
      await searchApiCards(t, {
        searchQuery: "note",
        createdAfter: twoWeeks.start,
        createdBefore: twoWeeks.end,
      })
    ).toEqual(["Resaved note", "Legacy note"]);
  });
});

describe("an API cursor issued before the saved-date order", () => {
  // Before the deploy no card had been saved again, so `createdAt` and
  // `savedAt` agree and the old anchor still marks the right place.
  test("a list cursor with a createdAt anchor pages on", async () => {
    const { t, ids } = await setup();
    const newest = (await t.run((ctx) =>
      ctx.db.get("cards", ids.get("Newest note") as Id<"cards">)
    )) as Doc<"cards">;
    const anchor = {
      createdAt: newest.createdAt,
      creationTime: newest._creationTime,
    };
    for (const legacy of [
      { mode: "list", anchor },
      // Its page belongs to the old index; it resumes from the anchor.
      { mode: "list", anchor, page: "a-page-of-the-created-index" },
    ]) {
      const page = await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        sort: "newest",
        scanLimit: 10,
        cursor: btoa(JSON.stringify(legacy)),
      });
      expect(contents(page.items)).toEqual(["Middle note", "Imported note"]);
    }
  });

  test("a match cursor with a createdAt anchor pages on", async () => {
    const { t, ids } = await setup(
      LIBRARY.map((card) => ({ ...card, tags: ["reading"] }))
    );
    const cursor = btoa(
      JSON.stringify({
        mode: "match",
        anchor: { createdAt: 3000, id: ids.get("Newest note") },
      })
    );
    const page = await t.query(internal.publicApi.searchCardsPageForUser, {
      userId: "owner",
      tag: "reading",
      sort: "newest",
      limit: 10,
      cursor,
    });
    expect(contents(page.items)).toEqual(["Middle note", "Imported note"]);
  });
});
