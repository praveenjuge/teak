/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getActiveCardCount } from "./card/cardUsage";
import { insertCompletedCards } from "./card/defaultCards";
import {
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content" | "type"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_archive",
    email_verified: true,
    external_id: "owner",
  });

  // Runs a card's tag sync chain to the end; the scheduler is paused.
  const syncTags = (cardId: Id<"cards">) =>
    t.run(async (ctx) => {
      for (let step = 0; step < 10; step += 1) {
        const state = await ctx.db
          .query("cardSearchTagSyncStates")
          .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
          .unique();
        if (state?.phase === "complete") {
          return;
        }
        await syncCardSearchTagsBatchHandler(ctx, cardId);
      }
    });

  const insert = async (seed: CardSeed, userId = "owner") => {
    const cardId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
    await syncTags(cardId);
    return cardId;
  };

  const setArchived = async (cardId: Id<"cards">, archived: boolean) => {
    await owner.mutation(api.cards.updateCardField, {
      cardId,
      field: archived ? "archive" : "unarchive",
    });
    await syncTags(cardId);
  };

  const grid = async (args: Record<string, unknown> = {}) =>
    (
      await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 50, cursor: null },
        ...args,
      })
    ).page.map((card: { content: string }) => card.content);

  const apiPage = async (args: Record<string, unknown>) =>
    (
      await t.query(internal.publicApi.searchCardsPageForUser, {
        userId: "owner",
        ...args,
      })
    ).items.map((card: { content: string }) => card.content);

  const apiList = async (args: Record<string, unknown> = {}) =>
    (
      await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        scanLimit: 50,
        ...args,
      })
    ).items.map((card: { content: string }) => card.content);

  return { t, owner, insert, setArchived, syncTags, grid, apiPage, apiList };
};

describe("an archived card leaves the library but stays in Archive", () => {
  // Color and style search run on array search fields, which convex-test
  // cannot evaluate; __tests__/card/visualFilters.test.ts covers them.
  test("hidden from every library read, listed in Archive", async () => {
    const { insert, setArchived, grid, apiPage, apiList, t } = await setup();
    await insert({
      content: "Kept moodboard",
      type: "image",
      tags: ["Moodboard"],
      isFavorited: true,
      visualStyles: ["minimal"],
      colorHues: ["blue"],
      colorHexes: ["#112233"],
    });
    const archived = await insert({
      content: "Archived moodboard",
      type: "image",
      tags: ["moodboard"],
      isFavorited: true,
      visualStyles: ["minimal"],
      colorHues: ["blue"],
      colorHexes: ["#112233"],
      createdAt: 2000,
    });
    await setArchived(archived, true);

    const kept = ["Kept moodboard"];
    expect(await grid()).toEqual(kept);
    expect(await grid({ favoritesOnly: true })).toEqual(kept);
    expect(await grid({ types: ["image"] })).toEqual(kept);
    expect(await grid({ searchQuery: "moodboard" })).toEqual(kept);
    expect(await apiPage({ tag: "moodboard" })).toEqual(kept);
    expect(await apiPage({ searchQuery: "moodboard" })).toEqual(kept);
    expect(await apiList()).toEqual(kept);
    const tags = await t.query(internal.publicApi.listTagsForUser, {
      userId: "owner",
    });
    expect(tags.items).toEqual([{ name: "moodboard", count: 1 }]);

    const archiveOnly = ["Archived moodboard"];
    expect(await grid({ showArchivedOnly: true })).toEqual(archiveOnly);
    expect(
      await grid({ showArchivedOnly: true, searchQuery: "moodboard" })
    ).toEqual(archiveOnly);
    expect(await apiList({ archived: "only" })).toEqual(archiveOnly);
    expect(await apiPage({ tag: "moodboard", archived: "only" })).toEqual(
      archiveOnly
    );
    expect(await apiList({ archived: "include" })).toEqual([
      "Archived moodboard",
      "Kept moodboard",
    ]);
    expect(
      await apiPage({ searchQuery: "moodboard", archived: "include" })
    ).toEqual(["Archived moodboard", "Kept moodboard"]);
    // Archived and not by tag reads one index and checks type and favorites
    // on each row.
    expect(await apiPage({ tag: "moodboard", archived: "include" })).toEqual([
      "Archived moodboard",
      "Kept moodboard",
    ]);
    expect(
      await apiPage({
        tag: "moodboard",
        archived: "include",
        type: "image",
        favorited: true,
      })
    ).toEqual(["Archived moodboard", "Kept moodboard"]);
    expect(
      await apiPage({ tag: "moodboard", archived: "include", type: "text" })
    ).toEqual([]);
  });

  test("unarchiving returns the card everywhere", async () => {
    const { insert, setArchived, grid, apiPage } = await setup();
    const id = await insert({
      content: "Round trip",
      type: "text",
      tags: ["x"],
    });
    await setArchived(id, true);
    expect(await grid()).toEqual([]);
    await setArchived(id, false);
    expect(await grid()).toEqual(["Round trip"]);
    expect(await grid({ searchQuery: "round" })).toEqual(["Round trip"]);
    expect(await apiPage({ tag: "x" })).toEqual(["Round trip"]);
    expect(await grid({ showArchivedOnly: true })).toEqual([]);
  });

  test("Trash lists an archived card, and restoring it returns it to Archive", async () => {
    const { insert, setArchived, grid, owner } = await setup();
    const id = await insert({ content: "Archived then trashed", type: "text" });
    await setArchived(id, true);
    await owner.mutation(api.cards.updateCardField, {
      cardId: id,
      field: "delete",
    });
    expect(await grid({ showTrashOnly: true })).toEqual([
      "Archived then trashed",
    ]);
    expect(await grid({ showArchivedOnly: true })).toEqual([]);
    expect(await grid({ showTrashOnly: true, searchQuery: "trashed" })).toEqual(
      ["Archived then trashed"]
    );

    await owner.mutation(api.cards.updateCardField, {
      cardId: id,
      field: "restore",
    });
    expect(await grid({ showArchivedOnly: true })).toEqual([
      "Archived then trashed",
    ]);
    expect(await grid()).toEqual([]);
  });

  test("an archived card still counts toward the card limit", async () => {
    const { t, insert, setArchived } = await setup();
    const id = await insert({ content: "Counted", type: "text" });
    const before = await t.run((ctx) => getActiveCardCount(ctx, "owner"));
    await setArchived(id, true);
    const after = await t.run((ctx) => getActiveCardCount(ctx, "owner"));
    expect(after).toBe(before);
    expect(after).toBe(1);
  });

  test("archiving twice keeps the first archived date", async () => {
    const { t, insert, setArchived } = await setup();
    const id = await insert({ content: "Once", type: "text" });
    await setArchived(id, true);
    const first = await t.run((ctx) => ctx.db.get("cards", id));
    vi.advanceTimersByTime(60_000);
    await setArchived(id, true);
    const second = await t.run((ctx) => ctx.db.get("cards", id));
    expect(second?.archivedAt).toBe(first?.archivedAt);
    expect(second?.isArchived).toBe(true);
  });
});

describe("bulk actions", () => {
  test("archive, favorite and tag many cards at once", async () => {
    const { owner, insert, grid, t } = await setup();
    const ids = [
      await insert({
        content: "One",
        type: "text",
        tags: ["Design"],
        createdAt: 2000,
      }),
      await insert({ content: "Two", type: "text", aiTags: ["design"] }),
    ];

    expect(
      await owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: ids,
        action: "addTags",
        tags: ["design", "Later", " later "],
      })
    ).toEqual({ updatedIds: ids, failedIds: [] });
    const tagged = await t.run(async (ctx) =>
      Promise.all(ids.map((id) => ctx.db.get("cards", id)))
    );
    // "design" matches the existing "Design" and is not added twice.
    expect(tagged.map((card) => card?.tags)).toEqual([
      ["Design", "Later"],
      ["design", "Later"],
    ]);

    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: ids,
      action: "removeTags",
      tags: ["DESIGN"],
    });
    const untagged = await t.run(async (ctx) =>
      Promise.all(ids.map((id) => ctx.db.get("cards", id)))
    );
    expect(untagged.map((card) => card?.tags)).toEqual([["Later"], ["Later"]]);
    expect(untagged[1]?.aiTags).toBeUndefined();

    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: ids,
      action: "favorite",
    });
    expect(await grid({ favoritesOnly: true })).toEqual(["One", "Two"]);

    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: ids,
      action: "archive",
    });
    expect(await grid()).toEqual([]);
    expect(await grid({ showArchivedOnly: true })).toEqual(["One", "Two"]);
  });

  test("another user's cards fail without changing them", async () => {
    const { owner, insert, t } = await setup();
    const mine = await insert({ content: "Mine", type: "text" });
    const theirs = await insert(
      { content: "Theirs", type: "text" },
      "stranger"
    );

    const result = await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [mine, theirs],
      action: "archive",
    });
    expect(result).toEqual({ updatedIds: [mine], failedIds: [theirs] });
    const card = await t.run((ctx) => ctx.db.get("cards", theirs));
    expect(card?.isArchived).toBeUndefined();
  });

  test("a retry succeeds on cards an earlier attempt already changed", async () => {
    const { owner, insert } = await setup();
    const ids = [
      await insert({ content: "A", type: "text" }),
      await insert({ content: "B", type: "text" }),
    ];
    for (const action of [
      "archive",
      "delete",
      "restore",
      "unarchive",
    ] as const) {
      const first = await owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: ids,
        action,
      });
      const retry = await owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: ids,
        action,
      });
      expect(first.failedIds).toEqual([]);
      expect(retry).toEqual(first);
    }
  });

  test("refuses more than 100 cards and an empty tag list", async () => {
    const { owner, insert, t } = await setup();
    const id = await insert({ content: "Only", type: "text" });
    // Repeated IDs count once.
    await expect(
      owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: Array.from({ length: 101 }, () => id),
        action: "archive",
      })
    ).resolves.toEqual({ updatedIds: [id], failedIds: [] });

    const many = await t.run(async (ctx) => {
      const created: Id<"cards">[] = [];
      for (let index = 0; index < 101; index += 1) {
        created.push(
          await ctx.db.insert("cards", {
            userId: "owner",
            type: "text",
            content: `Card ${index}`,
            createdAt: index,
            updatedAt: index,
          })
        );
      }
      return created;
    });
    await expect(
      owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: many,
        action: "archive",
      })
    ).rejects.toThrow("Change at most 100 cards at a time");
    await expect(
      owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: [id],
        action: "addTags",
        tags: ["  "],
      })
    ).rejects.toThrow("Name at least one tag");
  });

  test("restoring at the card limit fails without restoring the card", async () => {
    const { t, owner } = await setup();
    const trashed = await t.run(async (ctx) => {
      await insertCompletedCards(
        ctx,
        "owner",
        Array.from({ length: 200 }, (_, index) => ({
          type: "text" as const,
          content: `Active ${index}`,
        }))
      );
      return ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "In Trash",
        isDeleted: true,
        deletedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [trashed],
      action: "restore",
    });
    expect(result).toEqual({ updatedIds: [], failedIds: [trashed] });
    const card = await t.run((ctx) => ctx.db.get("cards", trashed));
    expect(card?.isDeleted).toBe(true);
    expect(await t.run((ctx) => getActiveCardCount(ctx, "owner"))).toBe(200);
  });
});

describe("public API archive", () => {
  test("PATCH isArchived archives and unarchives", async () => {
    const { t, insert } = await setup();
    const id = await insert({ content: "Patched", type: "text" });
    const archived = await t.mutation(internal.raycast.patchCardForUser, {
      userId: "owner",
      cardId: id,
      isArchived: true,
    });
    expect(archived?.isArchived).toBe(true);
    expect(typeof archived?.archivedAt).toBe("number");
    const back = await t.mutation(internal.raycast.patchCardForUser, {
      userId: "owner",
      cardId: id,
      isArchived: false,
    });
    expect(back?.isArchived).toBeUndefined();
  });

  test("bulk archive reports the cards that failed", async () => {
    const { t, insert } = await setup();
    const mine = await insert({ content: "Mine", type: "text" });
    const theirs = await insert(
      { content: "Theirs", type: "text" },
      "stranger"
    );
    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "archive",
        items: [{ cardId: mine }, { cardId: theirs }, { cardId: "nope" }],
      }
    );
    expect(result.summary).toEqual({ total: 3, succeeded: 1, failed: 2 });
    expect(result.failedIds).toEqual([theirs, "nope"]);
    expect(result.results[1]).toMatchObject({
      status: "error",
      code: "NOT_FOUND",
    });

    const tagged = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "addTags",
        items: [{ cardId: mine, tags: ["later"] }, { cardId: mine }],
      }
    );
    expect(
      tagged.results.map((item: { status: string }) => item.status)
    ).toEqual(["success", "error"]);
    expect(tagged.failedIds).toEqual([mine]);
  });
});
