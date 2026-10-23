import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { patchCardWithSearchSync } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const SAVED = "https://www.example.com/post/";

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });
  // A card written straight to the table, as cards from before `urlKey` and
  // `savedAt` existed were.
  let createdAt = 1000;
  const insertOld = (
    fields: Partial<Doc<"cards">> & Pick<Doc<"cards">, "type">
  ) =>
    t.run((ctx) => {
      createdAt += 1000;
      return ctx.db.insert("cards", {
        userId: "owner",
        content: fields.url ?? "note",
        createdAt,
        updatedAt: createdAt,
        ...fields,
      });
    });
  const get = (id: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", id)) as Promise<Doc<"cards">>;
  const duplicateOf = async (url: string) =>
    (await owner.query(api.card.findDuplicateCard.findDuplicateCard, { url }))
      ?._id ?? null;
  return { t, owner, insertOld, get, duplicateOf };
};

describe("the URL key", () => {
  test("a saved link gets its key, and a variant of it is found as a duplicate", async () => {
    const { owner, get, duplicateOf, t } = await setup();
    const id = await owner.mutation(api.card.createCard.createCard, {
      content: SAVED,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await get(id)).urlKey).toBe("example.com/post");
    for (const variant of [
      "http://example.com/post#top",
      "https://example.com/post?utm_source=newsletter&fbclid=x",
      "https://EXAMPLE.com:443/post/",
    ]) {
      expect(await duplicateOf(variant)).toBe(id);
    }
    expect(await duplicateOf("https://example.com/post?id=2")).toBeNull();
    expect(await duplicateOf("https://example.com/other")).toBeNull();
  });

  test("a card in Trash is never the duplicate; an archived one is", async () => {
    const { insertOld, duplicateOf } = await setup();
    await insertOld({
      type: "link",
      url: SAVED,
      urlKey: "example.com/post",
      isDeleted: true,
    });
    expect(await duplicateOf("http://example.com/post")).toBeNull();
    const archived = await insertOld({
      type: "link",
      url: SAVED,
      urlKey: "example.com/post",
      isArchived: true,
    });
    expect(await duplicateOf("http://example.com/post")).toBe(archived);
  });

  test("the newest of two cards for one link wins, keyed or not", async () => {
    const { insertOld, duplicateOf } = await setup();
    await insertOld({ type: "link", url: SAVED, urlKey: "example.com/post" });
    const newer = await insertOld({ type: "link", url: SAVED });
    expect(await duplicateOf(SAVED)).toBe(newer);
  });

  test("a card from before the key is still found by its exact address", async () => {
    const { insertOld, duplicateOf } = await setup();
    const old = await insertOld({ type: "link", url: SAVED });
    expect(await duplicateOf(SAVED)).toBe(old);
    // A variant needs the key, which the backfill adds.
    expect(await duplicateOf("http://example.com/post")).toBeNull();
  });

  test("editing a card's address moves its key with it", async () => {
    const { owner, get, duplicateOf, t } = await setup();
    const id = await owner.mutation(api.card.createCard.createCard, {
      content: SAVED,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await owner.mutation(api.card.updateCard.updateCardField, {
      cardId: id,
      field: "url",
      value: "https://example.com/moved?utm_campaign=x",
    });
    expect((await get(id)).urlKey).toBe("example.com/moved");
    expect(await duplicateOf("https://www.example.com/moved/")).toBe(id);
    expect(await duplicateOf("https://example.com/post")).toBeNull();
  });
});

describe("savedAt", () => {
  test("a new card is saved when it is created, and its folder and tag rows say so", async () => {
    const { owner, get, t } = await setup();
    const { _id: folderId } = await owner.mutation(api.folders.createFolder, {
      name: "Reading",
    });
    const id = await owner.mutation(api.card.createCard.createCard, {
      content: "A note worth keeping",
      tags: ["reading"],
    });
    await owner.mutation(api.folder.membership.addCardsToFolder, {
      folderId,
      cardIds: [id],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const card = await get(id);
    expect(card.savedAt).toBe(card.createdAt);
    const rows = await t.run(async (ctx) => ({
      folder: await ctx.db
        .query("folderCards")
        .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", id))
        .collect(),
      tags: await ctx.db
        .query("cardSearchTags")
        .withIndex("by_cardId_and_tag", (q) => q.eq("cardId", id))
        .collect(),
    }));
    expect(rows.folder.map((row) => row.cardSavedAt)).toEqual([card.createdAt]);
    expect(rows.tags.map((row) => row.cardSavedAt)).toEqual([card.createdAt]);
  });

  test("a later savedAt reaches the folder, tag and search rows", async () => {
    const { owner, t } = await setup();
    const { _id: folderId } = await owner.mutation(api.folders.createFolder, {
      name: "Reading",
    });
    const id = await owner.mutation(api.card.createCard.createCard, {
      content: "A note worth keeping",
      tags: ["reading"],
    });
    await owner.mutation(api.folder.membership.addCardsToFolder, {
      folderId,
      cardIds: [id],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = Date.now() + 86_400_000;
    await t.run((ctx) =>
      patchCardWithSearchSync(ctx, id, { savedAt: later, updatedAt: later })
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(async (ctx) => ({
      folder: await ctx.db
        .query("folderCards")
        .withIndex("by_folderId_and_isDeleted_and_cardSavedAt", (q) =>
          q
            .eq("folderId", folderId)
            .eq("isDeleted", undefined)
            .eq("cardSavedAt", later)
        )
        .collect(),
      tags: await ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_saved", (q) =>
          q
            .eq("userId", "owner")
            .eq("tag", "reading")
            .eq("isDeleted", undefined)
            .eq("cardSavedAt", later)
        )
        .collect(),
      document: await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", id))
        .unique(),
    }));
    expect(rows.folder.map((row) => row.cardId)).toEqual([id]);
    expect(rows.tags.map((row) => row.cardId)).toEqual([id]);
    expect(rows.document?.cardSavedAt).toBe(later);
  });
});

describe("the backfills", () => {
  const oldCards = async () => {
    const context = await setup();
    const { t, insertOld } = context;
    const linked = await insertOld({ type: "link", url: SAVED });
    const note = await insertOld({ type: "text", content: "plain" });
    const filed = await insertOld({ type: "text", content: "filed" });
    const folderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("folders", {
        userId: "owner",
        name: "Old",
        nameKey: "old",
        kind: "manual",
        activeCardCount: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const card = (await ctx.db.get("cards", filed)) as Doc<"cards">;
      await ctx.db.patch("cards", filed, { folderIds: [id] });
      await ctx.db.insert("folderCards", {
        folderId: id,
        cardId: filed,
        userId: "owner",
        type: "text",
        cardCreatedAt: card.createdAt,
        addedAt: 1,
      });
      await ctx.db.insert("cardSearchTags", {
        cardId: filed,
        userId: "owner",
        tag: "old",
        type: "text",
        cardCreatedAt: card.createdAt,
        sourceUpdatedAt: card.updatedAt,
        syncGeneration: 1,
      });
      return id;
    });
    return { ...context, linked, note, filed, folderId };
  };

  test("backfillUrlKey counts on a dry run, writes on a real one, then has nothing left", async () => {
    const { t, get, linked, note, duplicateOf } = await oldCards();
    const dry = await t.mutation(
      internal.migration.backfillUrlKey.backfillUrlKey,
      { once: true }
    );
    expect(dry.batch).toMatchObject({ examined: 3, cardsToUpdate: 1 });
    expect((await get(linked)).urlKey).toBeUndefined();

    const run = await t.mutation(
      internal.migration.backfillUrlKey.backfillUrlKey,
      { dryRun: false, once: true }
    );
    expect(run.batch.cardsToUpdate).toBe(1);
    expect((await get(linked)).urlKey).toBe("example.com/post");
    expect((await get(note)).urlKey).toBeUndefined();
    expect(await duplicateOf("http://example.com/post")).toBe(linked);

    const again = await t.mutation(
      internal.migration.backfillUrlKey.backfillUrlKey,
      { dryRun: false, once: true }
    );
    expect(again.batch.cardsToUpdate).toBe(0);
  });

  test("backfillSavedAt fills cards, folder rows and tag rows once", async () => {
    const { t, get, filed, folderId } = await oldCards();
    const dry = await t.mutation(
      internal.migration.backfillSavedAt.backfillSavedAt,
      { once: true }
    );
    expect(dry.batch).toMatchObject({
      examined: 3,
      cardsToUpdate: 3,
      folderRowsToUpdate: 1,
      tagRowsToUpdate: 1,
    });
    expect((await get(filed)).savedAt).toBeUndefined();

    await t.mutation(internal.migration.backfillSavedAt.backfillSavedAt, {
      dryRun: false,
      once: true,
    });
    const card = await get(filed);
    expect(card.savedAt).toBe(card.createdAt);
    const rows = await t.run(async (ctx) => ({
      folder: await ctx.db
        .query("folderCards")
        .withIndex("by_folderId_and_isDeleted_and_cardSavedAt", (q) =>
          q.eq("folderId", folderId)
        )
        .collect(),
      tags: await ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_saved", (q) =>
          q.eq("userId", "owner").eq("tag", "old")
        )
        .collect(),
    }));
    expect(rows.folder.map((row) => row.cardSavedAt)).toEqual([card.createdAt]);
    expect(rows.tags.map((row) => row.cardSavedAt)).toEqual([card.createdAt]);

    const again = await t.mutation(
      internal.migration.backfillSavedAt.backfillSavedAt,
      { dryRun: false, once: true }
    );
    expect(again.batch).toMatchObject({
      cardsToUpdate: 0,
      folderRowsToUpdate: 0,
      tagRowsToUpdate: 0,
    });
  });

  test("both backfills page through every card and stop", async () => {
    const { t, insertOld } = await setup();
    for (let index = 0; index < 5; index++) {
      await insertOld({ type: "link", url: `https://example.com/${index}/` });
    }
    await t.mutation(internal.migration.backfillUrlKey.backfillUrlKey, {
      dryRun: false,
      batchSize: 2,
    });
    await t.mutation(internal.migration.backfillSavedAt.backfillSavedAt, {
      dryRun: false,
      batchSize: 2,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const cards = await t.run((ctx) => ctx.db.query("cards").collect());
    expect(cards.every((card) => card.urlKey && card.savedAt)).toBe(true);
  });

  test("both backfills leave an account being deleted alone", async () => {
    const { t, get, linked } = await oldCards();
    await t.run(async (ctx) => {
      await ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        startedAt: 1,
      });
    });
    const keys = await t.mutation(
      internal.migration.backfillUrlKey.backfillUrlKey,
      { dryRun: false, once: true }
    );
    const saved = await t.mutation(
      internal.migration.backfillSavedAt.backfillSavedAt,
      { dryRun: false, once: true }
    );
    expect(keys.batch.skippedDeletingAccounts).toBe(1);
    expect(saved.batch.skippedDeletingAccounts).toBe(3);
    const card = await get(linked);
    expect(card.urlKey).toBeUndefined();
    expect(card.savedAt).toBeUndefined();
  });
});
