/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteAccountDataHandler } from "./accountDeletion";
import {
  searchCardsByDocument,
  syncCardSearchDocumentHandler,
} from "./card/searchDocumentHelpers";
import {
  FOLDER_DELETE_BATCH_SIZE,
  FOLDER_DELETE_UNDO_MS,
} from "./folder/folders";
import schema from "./schema";
import { MAX_FOLDERS_PER_CARD, MAX_FOLDERS_PER_USER } from "./shared/folders";

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

  const insert = (seed: CardSeed, userId = "owner") =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });

  const create = (name: string, as = owner) =>
    as.mutation(api.folders.createFolder, { name });

  const rows = (folderId: Id<"folders">) =>
    t.run((ctx) =>
      ctx.db
        .query("folderCards")
        .withIndex("by_folder_deleted_archived_created", (q) =>
          q.eq("folderId", folderId)
        )
        .collect()
    );

  const folder = (folderId: Id<"folders">) =>
    t.run((ctx) => ctx.db.get("folders", folderId));

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));

  const grid = async (args: Record<string, unknown> = {}) =>
    (
      await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 100, cursor: null },
        ...args,
      })
    ).page.map((item: { content: string }) => item.content);

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  return {
    t,
    owner,
    stranger,
    workosUserId,
    insert,
    create,
    rows,
    folder,
    card,
    grid,
    runScheduled,
  };
};

describe("folders", () => {
  test("create, rename, recolor and list by name", async () => {
    const { owner, create } = await setup();
    const zebra = await create("  Zebra  ");
    await create("apple");
    expect(zebra.name).toBe("Zebra");
    expect(zebra.activeCardCount).toBe(0);

    const renamed = await owner.mutation(api.folders.updateFolder, {
      folderId: zebra._id,
      name: "Banana",
      color: "blue",
    });
    expect(renamed).toMatchObject({ name: "Banana", color: "blue" });
    const cleared = await owner.mutation(api.folders.updateFolder, {
      folderId: zebra._id,
      color: null,
    });
    expect(cleared.color).toBeUndefined();

    const list = await owner.query(api.folders.listFolders, {});
    expect(list.map((item: { name: string }) => item.name)).toEqual([
      "apple",
      "Banana",
    ]);
  });

  test("names are unique per account, ignoring case", async () => {
    const { owner, stranger, create } = await setup();
    const design = await create("Design");
    await expect(create("design ")).rejects.toThrow(
      "A folder with this name already exists"
    );
    // Another account may use the same name.
    await expect(create("Design", stranger)).resolves.toMatchObject({
      name: "Design",
    });
    // Changing only the case of a folder's own name is allowed.
    await expect(
      owner.mutation(api.folders.updateFolder, {
        folderId: design._id,
        name: "DESIGN",
      })
    ).resolves.toMatchObject({ name: "DESIGN" });
    const other = await create("Other");
    await expect(
      owner.mutation(api.folders.updateFolder, {
        folderId: other._id,
        name: "design",
      })
    ).rejects.toThrow("A folder with this name already exists");
  });

  test("a name is still taken when older deleted folders share it", async () => {
    const { owner, create } = await setup();
    // Two folders named X are mid-delete (their rows remain), then a third
    // X is active: "x" must still clash with it.
    for (let round = 0; round < 2; round += 1) {
      const gone = await create("X");
      await owner.mutation(api.folders.deleteFolder, { folderId: gone._id });
    }
    await create("X");
    await expect(create("x")).rejects.toThrow(
      "A folder with this name already exists"
    );
  });

  test("names must be present and at most 300 characters", async () => {
    const { create } = await setup();
    await expect(create("   ")).rejects.toThrow("Name the folder");
    await expect(create("x".repeat(301))).rejects.toThrow(
      "at most 300 characters"
    );
    // Characters, not UTF-16 units: 300 emoji fit.
    await expect(create("📁".repeat(300))).resolves.toBeTruthy();
  });

  test(`an account can have up to ${MAX_FOLDERS_PER_USER} folders`, async () => {
    const { t, create } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < MAX_FOLDERS_PER_USER; index += 1) {
        await ctx.db.insert("folders", {
          userId: "owner",
          name: `Folder ${index}`,
          nameKey: `folder ${index}`,
          kind: "manual",
          activeCardCount: 0,
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    await expect(create("One too many")).rejects.toThrow(
      `You can have up to ${MAX_FOLDERS_PER_USER} folders`
    );
  });

  test("another account's folder cannot be read, changed or used", async () => {
    const { owner, stranger, create, insert } = await setup();
    const theirs = await create("Theirs", stranger);
    const mine = await insert({ content: "Mine", type: "text" });
    expect(
      await owner.query(api.folders.getFolder, { folderId: theirs._id })
    ).toBeNull();
    expect(
      await owner.query(api.folders.getFolder, { folderId: "not-an-id" })
    ).toBeNull();
    await expect(
      owner.mutation(api.folders.updateFolder, {
        folderId: theirs._id,
        name: "Taken",
      })
    ).rejects.toThrow("Folder not found");
    await expect(
      owner.mutation(api.folders.addCardsToFolder, {
        folderId: theirs._id,
        cardIds: [mine],
      })
    ).rejects.toThrow("Folder not found");
    await expect(
      owner.mutation(api.folders.deleteFolder, { folderId: theirs._id })
    ).rejects.toThrow("Folder not found");
    expect(
      await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 10, cursor: null },
        folderId: theirs._id,
      })
    ).toMatchObject({ page: [], isDone: true });
  });
});

describe("membership", () => {
  test("add, remove and move keep rows, counts and updatedAt in step", async () => {
    const { owner, stranger, create, insert, rows, folder, card } =
      await setup();
    const inbox = await create("Inbox");
    const done = await create("Done");
    const first = await insert({ content: "First", type: "text" });
    const second = await insert({
      content: "Second",
      type: "link",
      createdAt: 2000,
    });
    const theirs = await insert(
      { content: "Theirs", type: "text" },
      "stranger"
    );

    vi.setSystemTime(5000);
    const added = await owner.mutation(api.folders.addCardsToFolder, {
      folderId: inbox._id,
      cardIds: [first, second, theirs],
    });
    expect(added.updatedIds).toEqual([first, second]);
    expect(added.failedIds).toEqual([theirs]);
    expect((await card(first))?.folderIds).toEqual([inbox._id]);
    expect((await card(first))?.updatedAt).toBe(5000);
    expect((await rows(inbox._id)).map((row) => row.cardId).sort()).toEqual(
      [first, second].sort()
    );
    expect((await folder(inbox._id))?.activeCardCount).toBe(2);

    // Adding again is a no-op that still succeeds.
    vi.setSystemTime(6000);
    const again = await owner.mutation(api.folders.addCardsToFolder, {
      folderId: inbox._id,
      cardIds: [first],
    });
    expect(again.updatedIds).toEqual([first]);
    expect((await card(first))?.updatedAt).toBe(5000);
    expect((await folder(inbox._id))?.activeCardCount).toBe(2);

    // Move out of the folder being viewed into another.
    await owner.mutation(api.folders.moveCardsToFolder, {
      folderId: done._id,
      fromFolderId: inbox._id,
      cardIds: [second],
    });
    expect((await card(second))?.folderIds).toEqual([done._id]);
    expect((await folder(inbox._id))?.activeCardCount).toBe(1);
    expect((await folder(done._id))?.activeCardCount).toBe(1);

    await owner.mutation(api.folders.removeCardsFromFolder, {
      folderId: inbox._id,
      cardIds: [first],
    });
    expect((await card(first))?.folderIds).toBeUndefined();
    expect(await rows(inbox._id)).toEqual([]);
    expect((await folder(inbox._id))?.activeCardCount).toBe(0);

    // The stranger's card was never touched.
    expect((await card(theirs))?.folderIds).toBeUndefined();
    await expect(
      stranger.mutation(api.folders.setCardFolders, {
        cardId: first,
        folderIds: [],
      })
    ).rejects.toThrow("Card not found");
  });

  test("a move without a source folder leaves every other folder", async () => {
    const { owner, create, insert, card } = await setup();
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    const id = await insert({ content: "Card", type: "text" });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: id,
      folderIds: [a._id, b._id],
    });
    await owner.mutation(api.folders.moveCardsToFolder, {
      folderId: c._id,
      cardIds: [id],
    });
    expect((await card(id))?.folderIds).toEqual([c._id]);
  });

  test("a move without a source keeps folders that can still be undeleted", async () => {
    const { owner, create, insert, card } = await setup();
    const a = await create("A");
    const c = await create("C");
    const id = await insert({ content: "Card", type: "text" });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: a._id,
      cardIds: [id],
    });
    await owner.mutation(api.folders.deleteFolder, { folderId: a._id });
    await owner.mutation(api.folders.moveCardsToFolder, {
      folderId: c._id,
      cardIds: [id],
    });
    await owner.mutation(api.folders.restoreFolder, { folderId: a._id });
    expect((await card(id))?.folderIds).toEqual([a._id, c._id]);
  });

  test(`a card can be in up to ${MAX_FOLDERS_PER_CARD} folders`, async () => {
    const { owner, create, insert, card } = await setup();
    const id = await insert({ content: "Busy", type: "text" });
    const folders: Id<"folders">[] = [];
    for (let index = 0; index <= MAX_FOLDERS_PER_CARD; index += 1) {
      folders.push((await create(`F${index}`))._id);
    }
    await owner.mutation(api.folders.setCardFolders, {
      cardId: id,
      folderIds: folders.slice(0, MAX_FOLDERS_PER_CARD),
    });
    const result = await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folders[MAX_FOLDERS_PER_CARD],
      cardIds: [id],
    });
    expect(result.folderLimitIds).toEqual([id]);
    expect((await card(id))?.folderIds).toHaveLength(MAX_FOLDERS_PER_CARD);
    await expect(
      owner.mutation(api.folders.setCardFolders, {
        cardId: id,
        folderIds: folders,
      })
    ).rejects.toThrow(`A card can be in up to ${MAX_FOLDERS_PER_CARD} folders`);
  });

  test("bulk folder actions run through the bulk core", async () => {
    const { owner, create, insert, card } = await setup();
    const reading = await create("Reading");
    const id = await insert({ content: "Article", type: "link" });
    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [id],
      action: "addToFolder",
      folderId: reading._id,
    });
    expect((await card(id))?.folderIds).toEqual([reading._id]);
    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [id],
      action: "removeFromFolder",
      folderId: reading._id,
    });
    expect((await card(id))?.folderIds).toBeUndefined();
    await expect(
      owner.mutation(api.cards.bulkUpdateCards, {
        cardIds: [id],
        action: "addToFolder",
      })
    ).rejects.toThrow("Choose a folder");
  });
});

describe("folder view", () => {
  test("lists the folder's cards by saved date, without Trash or Archive", async () => {
    const { owner, create, insert, grid, folder, rows } = await setup();
    const trip = await create("Trip");
    const old = await insert({
      content: "Old",
      type: "image",
      createdAt: 1000,
    });
    const mid = await insert({ content: "Mid", type: "text", createdAt: 2000 });
    const recent = await insert({
      content: "Recent",
      type: "text",
      createdAt: 3000,
    });
    await insert({ content: "Elsewhere", type: "text", createdAt: 4000 });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: trip._id,
      cardIds: [mid, old, recent],
    });

    expect(await grid({ folderId: trip._id })).toEqual([
      "Recent",
      "Mid",
      "Old",
    ]);
    expect(await grid({ folderId: trip._id, sort: "oldest" })).toEqual([
      "Old",
      "Mid",
      "Recent",
    ]);
    expect(await grid({ folderId: trip._id, types: ["image"] })).toEqual([
      "Old",
    ]);
    expect(await grid({ folderId: trip._id, searchQuery: "recent" })).toEqual([
      "Recent",
    ]);

    // Trash and Archive drop a card out of the folder and its count...
    await owner.mutation(api.cards.updateCardField, {
      cardId: recent,
      field: "delete",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: mid,
      field: "archive",
    });
    expect(await grid({ folderId: trip._id })).toEqual(["Old"]);
    expect((await folder(trip._id))?.activeCardCount).toBe(1);
    const flags = (await rows(trip._id)).map((row) => [
      row.cardId,
      row.isDeleted ?? null,
      row.isArchived ?? null,
    ]);
    expect(flags).toContainEqual([recent, true, null]);
    expect(flags).toContainEqual([mid, null, true]);

    // ...and restore or unarchive brings it back.
    await owner.mutation(api.cards.updateCardField, {
      cardId: recent,
      field: "restore",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: mid,
      field: "unarchive",
    });
    expect(await grid({ folderId: trip._id })).toEqual([
      "Recent",
      "Mid",
      "Old",
    ]);
    expect((await folder(trip._id))?.activeCardCount).toBe(3);
  });

  test("colors and favorites find the folder's older cards past a busy library", async () => {
    const { owner, create, insert } = await setup();
    const shelf = await create("Shelf");
    const oldRed = await insert({
      content: "Old red",
      type: "palette",
      colorHues: ["red"],
      isFavorited: true,
      createdAt: 10,
    });
    const inFolder = [oldRed];
    // The folder's newest cards are neither red nor favorites, and the
    // library holds many newer red favorites outside the folder.
    for (let index = 0; index < 5; index += 1) {
      inFolder.push(
        await insert({
          content: `Plain ${index}`,
          type: "text",
          createdAt: 100 + index,
        })
      );
    }
    for (let index = 0; index < 40; index += 1) {
      await insert({
        content: `Other red ${index}`,
        type: "palette",
        colorHues: ["red"],
        isFavorited: true,
        createdAt: 1000 + index,
      });
    }
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: shelf._id,
      cardIds: inFolder,
    });
    const firstPage = async (args: Record<string, unknown>) =>
      (
        await owner.query(api.cards.searchCardsPaginated, {
          paginationOpts: { numItems: 2, cursor: null },
          folderId: shelf._id,
          ...args,
        })
      ).page.map((item: { content: string }) => item.content);

    expect(await firstPage({ hueFilters: ["red"] })).toEqual(["Old red"]);
    expect(await firstPage({ favoritesOnly: true })).toEqual(["Old red"]);
  });

  test("quick command words search inside a folder instead of the library", async () => {
    const { owner, create, insert, grid } = await setup();
    const box = await create("Box");
    const kept = await insert({
      content: "My favorites list",
      type: "text",
      isFavorited: true,
    });
    await insert({
      content: "Favorite elsewhere",
      type: "text",
      isFavorited: true,
    });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: box._id,
      cardIds: [kept],
    });
    expect(await grid({ folderId: box._id, searchQuery: "favorites" })).toEqual(
      ["My favorites list"]
    );
    expect(await grid({ folderId: box._id, searchQuery: "trash" })).toEqual([]);
  });

  test("a saturated text search in a folder keeps every folder match it found", async () => {
    const { t, owner, create, grid } = await setup();
    const shelf = await create("Shelf");
    // 1,100 matches fill the search index's 1,024 results; every third one
    // is in the folder, too few to fill the candidate set, so the filtered
    // search gives up and falls back.
    await t.run(async (ctx) => {
      for (let index = 0; index < 1100; index += 1) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: `deepsearch ${index}`,
          createdAt: index + 2,
          updatedAt: index + 2,
          ...(index % 3 === 0 ? { folderIds: [shelf._id] } : {}),
        });
        await syncCardSearchDocumentHandler(ctx, id);
      }
    });
    const inFolder = (
      await grid({ folderId: shelf._id, searchQuery: "deepsearch" })
    ).length;
    const searched = await t.run((ctx) =>
      searchCardsByDocument(ctx, {
        userId: "owner",
        searchQuery: "deepsearch",
        limit: 1024,
      })
    );
    const reachable = searched.filter((card) =>
      (card.folderIds ?? []).includes(shelf._id)
    ).length;
    expect(reachable).toBeGreaterThan(100);
    // grid() reads one page of 100; page through to count them all.
    let total = 0;
    let cursor: string | null = null;
    for (;;) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: unknown[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 100, cursor },
        folderId: shelf._id,
        searchQuery: "deepsearch",
      });
      total += result.page.length;
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    expect(inFolder).toBe(100);
    expect(total).toBe(reachable);
  }, 60_000);

  test("a color filter pages through a large folder to its oldest match", async () => {
    const { t, owner, create } = await setup();
    const shelf = await create("Shelf");
    // 450 cards in the folder; only the oldest is red.
    await t.run(async (ctx) => {
      for (let index = 0; index < 450; index += 1) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "palette",
          content: index === 0 ? "Oldest red" : `Blue ${index}`,
          colorHues: [index === 0 ? "red" : "blue"],
          createdAt: index + 2,
          updatedAt: index + 2,
          folderIds: [shelf._id],
        });
        await syncCardSearchDocumentHandler(ctx, id);
      }
    });
    const found: string[] = [];
    let pages = 0;
    let cursor: string | null = null;
    for (;;) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: { content: string }[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 50, cursor },
        folderId: shelf._id,
        hueFilters: ["red"],
      });
      pages += 1;
      found.push(...result.page.map((card) => card.content));
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    expect(found).toEqual(["Oldest red"]);
    expect(pages).toBeGreaterThan(1);
  }, 60_000);

  test("Trash in a folder is in date order across archived and active cards", async () => {
    const { owner, create, insert, grid } = await setup();
    const box = await create("Box");
    const ids = [
      await insert({ content: "Newest", type: "text", createdAt: 3000 }),
      await insert({ content: "Middle", type: "text", createdAt: 2000 }),
      await insert({ content: "Oldest", type: "text", createdAt: 1000 }),
    ];
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: box._id,
      cardIds: ids,
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: ids[1],
      field: "archive",
    });
    for (const cardId of ids) {
      await owner.mutation(api.cards.updateCardField, {
        cardId,
        field: "delete",
      });
    }
    expect(await grid({ folderId: box._id, showTrashOnly: true })).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  test("a hard-deleted card leaves no folder rows behind", async () => {
    const { t, owner, create, insert, rows, folder, runScheduled } =
      await setup();
    const box = await create("Box");
    const id = await insert({ content: "Gone", type: "text" });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: box._id,
      cardIds: [id],
    });
    await owner.mutation(api.cards.permanentDeleteCard, { id });
    await runScheduled();
    expect(await rows(box._id)).toEqual([]);
    expect((await folder(box._id))?.activeCardCount).toBe(0);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("folderCards")
          .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", id))
          .collect()
      )
    ).toEqual([]);
  });
});

describe("deleting a folder", () => {
  test("hides it at once and can be undone before cards are detached", async () => {
    const { owner, create, insert, card, folder } = await setup();
    const keep = await create("Keep");
    const id = await insert({ content: "Kept", type: "text" });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: keep._id,
      cardIds: [id],
    });
    await owner.mutation(api.folders.deleteFolder, { folderId: keep._id });
    expect(await owner.query(api.folders.listFolders, {})).toEqual([]);
    expect(
      await owner.query(api.folders.getFolder, { folderId: keep._id })
    ).toBeNull();

    await owner.mutation(api.folders.restoreFolder, { folderId: keep._id });
    vi.advanceTimersByTime(FOLDER_DELETE_UNDO_MS + 1);
    expect((await owner.query(api.folders.listFolders, {})).length).toBe(1);
    expect((await card(id))?.folderIds).toEqual([keep._id]);
    expect((await folder(keep._id))?.activeCardCount).toBe(1);
  });

  test("detaches every card in pages, then removes the folder", async () => {
    const { t, owner, create, insert, card, rows, folder, runScheduled } =
      await setup();
    const big = await create("Big");
    const other = await create("Other");
    const total = FOLDER_DELETE_BATCH_SIZE * 2 + 5;
    const ids: Id<"cards">[] = [];
    for (let index = 0; index < total; index += 1) {
      ids.push(
        await insert({
          content: `Card ${index}`,
          type: "text",
          createdAt: index,
        })
      );
    }
    for (let start = 0; start < ids.length; start += 100) {
      await owner.mutation(api.folders.addCardsToFolder, {
        folderId: big._id,
        cardIds: ids.slice(start, start + 100),
      });
    }
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: other._id,
      cardIds: [ids[0]],
    });
    // Archived and trashed members are detached too.
    await owner.mutation(api.cards.updateCardField, {
      cardId: ids[1],
      field: "archive",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: ids[2],
      field: "delete",
    });

    await owner.mutation(api.folders.deleteFolder, { folderId: big._id });
    await expect(
      owner.mutation(api.folders.createFolder, { name: "big" })
    ).resolves.toBeTruthy();
    await runScheduled();

    expect(await folder(big._id)).toBeNull();
    expect(await rows(big._id)).toEqual([]);
    expect((await card(ids[0]))?.folderIds).toEqual([other._id]);
    expect((await card(ids[1]))?.folderIds).toBeUndefined();
    expect((await card(ids[2]))?.folderIds).toBeUndefined();
    expect((await folder(other._id))?.activeCardCount).toBe(1);
    await expect(
      owner.mutation(api.folders.restoreFolder, { folderId: big._id })
    ).rejects.toThrow("Folder not found");
    const leftovers = await t.run((ctx) =>
      ctx.db.query("folderCards").collect()
    );
    expect(leftovers.map((row) => row.folderId)).toEqual([other._id]);
  });

  test("a batch from an undone delete leaves a later delete's Undo alone", async () => {
    const { t, owner, create, insert, card, folder } = await setup();
    const again = await create("Again");
    const id = await insert({ content: "Still here", type: "text" });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: again._id,
      cardIds: [id],
    });
    // Delete, Undo, then delete again 3 seconds in: the first delete's batch
    // fires while the second delete can still be undone.
    await owner.mutation(api.folders.deleteFolder, { folderId: again._id });
    await owner.mutation(api.folders.restoreFolder, { folderId: again._id });
    vi.advanceTimersByTime(3000);
    await owner.mutation(api.folders.deleteFolder, { folderId: again._id });
    vi.advanceTimersByTime(FOLDER_DELETE_UNDO_MS - 2000);
    await t.finishInProgressScheduledFunctions();

    await owner.mutation(api.folders.restoreFolder, { folderId: again._id });
    expect((await card(id))?.folderIds).toEqual([again._id]);
    expect((await folder(again._id))?.activeCardCount).toBe(1);
  });

  test("Undo fails once the window has passed or the name was taken", async () => {
    const { owner, create } = await setup();
    const late = await create("Late");
    await owner.mutation(api.folders.deleteFolder, { folderId: late._id });
    await create("Late");
    await expect(
      owner.mutation(api.folders.restoreFolder, { folderId: late._id })
    ).rejects.toThrow("A folder with this name already exists");

    const slow = await create("Slow");
    await owner.mutation(api.folders.deleteFolder, { folderId: slow._id });
    vi.setSystemTime(Date.now() + FOLDER_DELETE_UNDO_MS);
    await expect(
      owner.mutation(api.folders.restoreFolder, { folderId: slow._id })
    ).rejects.toThrow("can no longer be restored");
  });
});

test("account deletion leaves no folders or folder rows", async () => {
  const { t, owner, create, insert, workosUserId } = await setup();
  const ids = [
    await insert({ content: "A", type: "text" }),
    await insert({ content: "B", type: "text" }),
  ];
  const a = await create("A");
  const b = await create("B");
  await owner.mutation(api.folders.addCardsToFolder, {
    folderId: a._id,
    cardIds: ids,
  });
  await owner.mutation(api.folders.addCardsToFolder, {
    folderId: b._id,
    cardIds: [ids[0]],
  });
  const stateId = await t.run((ctx) =>
    ctx.db.insert("accountDeletionStates", {
      userId: "owner",
      startedAt: Date.now(),
      workosUserId,
      stage: 3,
      generation: 1,
    })
  );
  await t.run((ctx) => deleteAccountDataHandler(ctx, "owner", ids));
  expect(await t.run((ctx) => ctx.db.query("folderCards").collect())).toEqual(
    []
  );
  for (let page = 0; page < 5; page += 1) {
    const more = await t.mutation(internal.accountDeletionData.ancillaryPage, {
      stateId,
      generation: 1,
    });
    if (!more) {
      break;
    }
  }
  expect(await t.run((ctx) => ctx.db.query("folders").collect())).toEqual([]);
});
