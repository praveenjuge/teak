/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

let nextCreatedAt = 1000;

const setup = async () => {
  nextCreatedAt = 1000;
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const strangerWorkosId = await seedWorkosOwner(t, "stranger");
  const identity = (subject: string, externalId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject,
      sid: `session_${externalId}`,
      email_verified: true,
      external_id: externalId,
    });
  const owner = identity(workosUserId, "owner");
  const stranger = identity(strangerWorkosId, "stranger");

  const insert = (seed: CardSeed, userId = "owner") => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        type: seed.url ? "link" : "text",
        createdAt,
        updatedAt: createdAt,
        shuffleKey: (createdAt % 97) / 97,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };

  /** A card saved before the flag existed: reserved tag, no `isHidden`. */
  const unflag = (cardId: Id<"cards">) =>
    t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, { isHidden: undefined });
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .unique();
      if (document) {
        await ctx.db.patch("cardSearchDocuments", document._id, {
          isHidden: undefined,
        });
      }
    });

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));

  const searchDocument = (cardId: Id<"cards">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .unique()
    );

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  /** Every page of the grid's read, as card contents. */
  const grid = async (
    args: Record<string, unknown> = {},
    as = owner,
    query: typeof api.cards.searchCardsPaginated = api.cards
      .searchCardsPaginated
  ) => {
    await runScheduled();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: { content?: string; title?: string }[];
      } = await as.query(query, {
        ...args,
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((item) => item.content ?? item.title ?? ""));
      if (result.isDone || !result.continueCursor) {
        return seen.sort();
      }
      cursor = result.continueCursor;
    }
    throw new Error("read did not finish");
  };

  return {
    t,
    owner,
    stranger,
    insert,
    unflag,
    card,
    searchDocument,
    grid,
    runScheduled,
  };
};

type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * A library with one visible card and one hidden card in each place a read
 * can find it, plus a card whose only `hidden` is an AI tag.
 */
const seedLibrary = async ({ insert, owner, t }: Setup) => {
  const folder = await owner.mutation(api.folders.createFolder, {
    name: "Beach trips",
  });
  const ids = {
    shown: await insert({
      content: "beach shown",
      tags: ["trip"],
      url: "https://photos.example/a",
    }),
    hidden: await insert({
      content: "beach hidden",
      tags: ["trip", " Secret"],
      url: "https://photos.example/b",
    }),
    aiOnly: await insert({ content: "beach ai only", aiTags: ["hidden"] }),
    favoriteHidden: await insert({
      content: "beach favorite hidden",
      tags: ["HIDDEN "],
      isFavorited: true,
    }),
    archivedHidden: await insert({
      content: "beach archived hidden",
      tags: ["hidden"],
      isArchived: true,
    }),
    trashedHidden: await insert({
      content: "beach trashed hidden",
      tags: ["secret"],
      isDeleted: true,
    }),
  };
  for (const cardId of [ids.shown, ids.hidden]) {
    await owner.mutation(api.folders.setCardFolders, {
      cardId,
      folderIds: [folder._id],
    });
  }
  const smart = await owner.mutation(api.folders.createFolder, {
    name: "Trip smart",
    kind: "smart",
    query: "#trip",
  });
  const secretSmart = await owner.mutation(api.folders.createFolder, {
    name: "Secret smart",
    kind: "smart",
    query: "#secret",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { ids, folder, smart, secretSmart };
};

describe("the isHidden flag", () => {
  test("follows the reserved user tags on create, edit and untag", async () => {
    const { owner, card, searchDocument, runScheduled } = await setup();
    const id = await owner.mutation(api.cards.createCard, {
      content: "created hidden",
      tags: ["  SECRET "],
    });
    await runScheduled();
    expect((await card(id))?.isHidden).toBe(true);
    expect((await searchDocument(id))?.isHidden).toBe(true);

    await owner.mutation(api.cards.updateCardField, {
      cardId: id,
      field: "tags",
      value: ["work"],
    });
    await runScheduled();
    expect((await card(id))?.isHidden).toBeUndefined();
    expect((await searchDocument(id))?.isHidden).toBeUndefined();

    await owner.mutation(api.cards.updateCardField, {
      cardId: id,
      field: "tags",
      value: ["work", "Hidden"],
    });
    // The flag lands in the tag edit's own write.
    expect((await card(id))?.isHidden).toBe(true);
  });

  test("an AI tag never hides a card", async () => {
    const { insert, card } = await setup();
    const id = await insert({ content: "ai", aiTags: ["hidden", "secret"] });
    expect((await card(id))?.isHidden).toBeUndefined();
  });

  test("a rename into a reserved tag hides the cards", async () => {
    const { owner, insert, card, runScheduled } = await setup();
    const id = await insert({ content: "renamed", tags: ["secret"] });
    await runScheduled();
    await owner.mutation(api.tags.startTagOperation, {
      kind: "rename",
      from: "secret",
      to: "secret",
    });
    await runScheduled();
    expect((await card(id))?.isHidden).toBe(true);
  });
});

describe.each([
  ["flagged", false],
  ["not yet backfilled", true],
] as const)("hidden cards (%s)", (_name, unflagged) => {
  const prepare = async () => {
    const context = await setup();
    const library = await seedLibrary(context);
    if (unflagged) {
      for (const cardId of [
        library.ids.hidden,
        library.ids.favoriteHidden,
        library.ids.archivedHidden,
        library.ids.trashedHidden,
      ]) {
        await context.unflag(cardId);
      }
      expect((await context.card(library.ids.hidden))?.isHidden).toBe(
        undefined
      );
    }
    return { ...context, ...library };
  };

  test("the grid leaves them out of every view", async () => {
    const { grid, folder, smart } = await prepare();
    expect(await grid()).toEqual(["beach ai only", "beach shown"]);
    expect(await grid({ favoritesOnly: true })).toEqual([]);
    expect(await grid({ showArchivedOnly: true })).toEqual([]);
    expect(await grid({ showTrashOnly: true })).toEqual([]);
    expect(await grid({ searchQuery: "beach" })).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(await grid({ searchQuery: "secret" })).toEqual([]);
    expect(await grid({ searchQuery: "site:photos.example" })).toEqual([
      "beach shown",
    ]);
    expect(await grid({ tag: "trip" })).toEqual(["beach shown"]);
    expect(await grid({ folderId: folder._id })).toEqual(["beach shown"]);
    expect(await grid({ folderId: smart._id })).toEqual(["beach shown"]);
    expect(await grid({ sort: "shuffle", shuffleSeed: 7 })).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(
      await grid({ sort: "shuffle", shuffleSeed: 7, searchQuery: "is:fav" })
    ).toEqual([]);
  });

  test("a search for a reserved tag shows them", async () => {
    const { grid, folder, secretSmart } = await prepare();
    expect(await grid({ searchQuery: "#secret" })).toEqual(["beach hidden"]);
    // A tag search matches AI tags too; the AI-only card was never hidden.
    expect(await grid({ searchQuery: "tag:HIDDEN" })).toEqual([
      "beach ai only",
      "beach favorite hidden",
    ]);
    expect(await grid({ tag: "hidden", showArchivedOnly: true })).toEqual([
      "beach archived hidden",
    ]);
    expect(await grid({ tag: "secret", showTrashOnly: true })).toEqual([
      "beach trashed hidden",
    ]);
    expect(await grid({ searchQuery: "beach #secret" })).toEqual([
      "beach hidden",
    ]);
    expect(
      await grid({ searchQuery: "#secret #trip site:photos.example" })
    ).toEqual(["beach hidden"]);
    expect(
      await grid({ searchQuery: "#secret", folderId: folder._id })
    ).toEqual(["beach hidden"]);
    expect(await grid({ folderId: secretSmart._id })).toEqual(["beach hidden"]);
    expect(
      await grid({ searchQuery: "#secret", sort: "shuffle", shuffleSeed: 3 })
    ).toEqual(["beach hidden"]);
  });

  test("mobile summaries, the older list queries and top sites leave them out", async () => {
    const { owner, grid } = await prepare();
    // A summary's title is the link's host.
    expect(
      await grid({}, owner, api.cards.searchMobileCardSummariesPaginated)
    ).toEqual(["beach ai only", "photos.example"]);
    const contents = (cards: { content: string }[]) =>
      cards.map((item) => item.content).sort();
    expect(contents(await owner.query(api.cards.getCards, {}))).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(
      contents(await owner.query(api.cards.getCards, { favoritesOnly: true }))
    ).toEqual([]);
    expect(contents(await owner.query(api.cards.searchCards, {}))).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(
      contents(
        await owner.query(api.cards.searchCards, { searchQuery: "beach" })
      )
    ).toEqual(["beach ai only", "beach shown"]);
    expect(contents(await owner.query(api.cards.getDeletedCards, {}))).toEqual(
      []
    );
    expect(await owner.query(api.cards.listTopSites, {})).toEqual([
      { host: "photos.example", label: "photos.example", count: 1 },
    ]);
  });

  test("Raycast leaves them out unless its tag is a reserved one", async () => {
    const { t } = await prepare();
    const contents = (cards: { content: string }[]) =>
      cards.map((item) => item.content).sort();
    const raycast = (args: Record<string, unknown>) =>
      t
        .query(internal.raycast.searchCardsForUser, {
          userId: "owner",
          ...args,
        })
        .then(contents);
    expect(await raycast({})).toEqual(["beach ai only", "beach shown"]);
    expect(await raycast({ searchQuery: "beach" })).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(await raycast({ tag: "trip" })).toEqual(["beach shown"]);
    expect(await raycast({ tag: "Secret" })).toEqual(["beach hidden"]);
    expect(
      contents(
        await t.query(internal.raycast.favoriteCardsForUser, {
          userId: "owner",
        })
      )
    ).toEqual([]);
  });

  test("the public API leaves them out unless the search names a reserved tag", async () => {
    const { t } = await prepare();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content).sort();
    const scan = (args: Record<string, unknown>) =>
      t
        .query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          ...args,
        })
        .then(contents);
    const search = (args: Record<string, unknown>) =>
      t
        .query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          ...args,
        })
        .then(contents);
    const shuffle = (args: Record<string, unknown>) =>
      t
        .query(internal.publicApi.shuffleCardsPageForUser, {
          userId: "owner",
          shuffleSeed: 11,
          limit: 50,
          ...args,
        })
        .then(contents);

    expect(await scan({})).toEqual(["beach ai only", "beach shown"]);
    expect(await scan({ favorited: true })).toEqual([]);
    expect(await scan({ archived: "only" })).toEqual([]);
    expect(await scan({ showTrashOnly: true })).toEqual([]);
    expect(await scan({ sites: ["photos.example"] })).toEqual(["beach shown"]);
    expect(await scan({ folderNames: ["beach trips"] })).toEqual([
      "beach shown",
    ]);
    expect(await scan({ tags: ["secret"] })).toEqual(["beach hidden"]);

    expect(await search({ searchQuery: "beach" })).toEqual([
      "beach ai only",
      "beach shown",
    ]);
    expect(await search({ searchQuery: "secret" })).toEqual([]);
    expect(await search({ tag: "trip" })).toEqual(["beach shown"]);
    expect(await search({ tag: "secret" })).toEqual(["beach hidden"]);
    expect(await search({ searchQuery: "beach", tags: ["hidden"] })).toEqual([
      "beach ai only",
      "beach favorite hidden",
    ]);

    expect(await shuffle({})).toEqual(["beach ai only", "beach shown"]);
    expect(await shuffle({ folderNames: ["beach trips"] })).toEqual([
      "beach shown",
    ]);
    expect(await shuffle({ tag: "trip" })).toEqual(["beach shown"]);
    expect(await shuffle({ tag: "secret" })).toEqual(["beach hidden"]);
  });

  test("a get by id and the changes feed still return them, marked", async () => {
    const { owner, stranger, t, ids } = await prepare();
    const own = await owner.query(api.cards.getCard, { id: ids.hidden });
    expect(own?.content).toBe("beach hidden");
    expect(await stranger.query(api.cards.getCard, { id: ids.hidden })).toBe(
      null
    );
    const changes = await t.query(internal.publicApi.listCardChangesForUser, {
      userId: "owner",
      since: 0,
      limit: 50,
    });
    expect(JSON.stringify(changes)).toContain("beach hidden");
  });

  test("an empty view knows when hidden cards emptied it", async () => {
    const { owner, stranger, folder } = await prepare();
    const has = (args: Record<string, unknown>, as = owner) =>
      as.query(api.cards.viewHasHiddenCards, args);
    expect(await has({ view: "favorites" })).toBe(true);
    expect(await has({ view: "archive" })).toBe(true);
    expect(await has({ view: "trash" })).toBe(true);
    // Someone else's folder, and an account with nothing hidden.
    expect(await has({ folderId: folder._id }, stranger)).toBe(false);
    expect(await has({ view: "favorites" }, stranger)).toBe(false);
  });

  test("another user's reserved-tag search shows none of them", async () => {
    const { grid, stranger } = await prepare();
    expect(await grid({ searchQuery: "#secret" }, stranger)).toEqual([]);
    expect(await grid({ tag: "secret" }, stranger)).toEqual([]);
  });
});

describe("backfillHiddenCards", () => {
  const seedLegacy = async ({ insert, unflag, t }: Setup) => {
    const ids = {
      secret: await insert({ content: "a", tags: ["Secret"] }),
      both: await insert({ content: "b", tags: ["HIDDEN", " secret "] }),
      plain: await insert({ content: "c", tags: ["work"] }),
      ai: await insert({ content: "d", aiTags: ["hidden"] }),
      stranger: await insert({ content: "e", tags: ["secret"] }, "stranger"),
      stale: await insert({ content: "f" }),
    };
    for (const id of [ids.secret, ids.both, ids.stranger]) {
      await unflag(id);
    }
    // A flag left behind on a card that no longer has the tag.
    await t.run((ctx) => ctx.db.patch("cards", ids.stale, { isHidden: true }));
    return ids;
  };

  test("a dry run reports counts per tag and users, and writes nothing", async () => {
    const context = await setup();
    const ids = await seedLegacy(context);
    const result = await context.t.mutation(
      internal.migration.backfillHiddenCards.backfillHiddenCards,
      { batchSize: 2 }
    );
    expect(result).toMatchObject({ dryRun: true, continuationScheduled: true });
    await context.runScheduled();
    for (const id of [ids.secret, ids.both, ids.stranger]) {
      expect((await context.card(id))?.isHidden).toBeUndefined();
    }
    expect((await context.card(ids.stale))?.isHidden).toBe(true);

    const all = await context.t.mutation(
      internal.migration.backfillHiddenCards.backfillHiddenCards,
      { batchSize: 200, once: true }
    );
    expect(all.totals).toEqual({
      examined: 6,
      hiddenCards: 3,
      cardsToUpdate: 4,
      searchDocumentsToUpdate: 3,
      skippedDeletingAccounts: 0,
      tags: { secret: 3, hidden: 1 },
      affectedUsers: 2,
    });
  });

  test("a real run pages, sets both rows, skips deleting accounts and is idempotent", async () => {
    const context = await setup();
    const ids = await seedLegacy(context);
    await context.t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "stranger",
        startedAt: 1,
      })
    );
    const first = await context.t.mutation(
      internal.migration.backfillHiddenCards.backfillHiddenCards,
      { dryRun: false, batchSize: 2, once: true }
    );
    expect(first).toMatchObject({
      isDone: false,
      continuationScheduled: false,
      batch: { examined: 2, cardsToUpdate: 2, searchDocumentsToUpdate: 2 },
    });
    expect((await context.card(ids.plain))?.isHidden).toBeUndefined();

    await context.t.mutation(
      internal.migration.backfillHiddenCards.backfillHiddenCards,
      { dryRun: false, batchSize: 2, cursor: first.continueCursor }
    );
    await context.runScheduled();

    for (const id of [ids.secret, ids.both]) {
      expect((await context.card(id))?.isHidden).toBe(true);
      expect((await context.searchDocument(id))?.isHidden).toBe(true);
    }
    for (const id of [ids.plain, ids.ai, ids.stale]) {
      expect((await context.card(id))?.isHidden).toBeUndefined();
    }
    expect((await context.card(ids.stranger))?.isHidden).toBeUndefined();

    const again = await context.t.mutation(
      internal.migration.backfillHiddenCards.backfillHiddenCards,
      { dryRun: false, batchSize: 200, once: true }
    );
    expect(again.batch).toMatchObject({
      examined: 6,
      cardsToUpdate: 0,
      searchDocumentsToUpdate: 0,
      skippedDeletingAccounts: 1,
    });
  });
});

describe("viewHasHiddenCards", () => {
  test("an empty folder or library is told apart from one whose cards are hidden", async () => {
    const { owner, insert, runScheduled } = await setup();
    const folder = await owner.mutation(api.folders.createFolder, {
      name: "Secret trips",
    });
    const has = (args: Record<string, unknown>) =>
      owner.query(api.cards.viewHasHiddenCards, args);
    expect(await has({ view: "all" })).toBe(false);
    expect(await has({ folderId: folder._id })).toBe(false);

    const id = await insert({ content: "only card", tags: ["secret"] });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: id,
      folderIds: [folder._id],
    });
    await runScheduled();
    expect(await has({ view: "all" })).toBe(true);
    expect(await has({ folderId: folder._id })).toBe(true);
  });
});
