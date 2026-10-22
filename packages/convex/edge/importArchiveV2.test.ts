import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertCompletedCards } from "../card/defaultCards";
import { readFolderCardCount } from "../folder/folderRows";
import { insertFolder } from "../folder/folders";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

interface ItemSeed {
  content: string;
  folders?: string[];
  importedCompletedAt?: number;
  isArchived?: boolean;
  metadataTitle?: string;
  type?: "text" | "link";
  url?: string;
}

const setup = async (mode: "archive" | "bookmarks" | "pocket" = "archive") => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  await seedWorkosOwner(t, "owner");
  const newJob = () =>
    t.run((ctx) =>
      ctx.db.insert("importJobs", {
        userId: "owner",
        mode,
        status: "importing",
        phase: "Importing",
        fileName: "teak-export.zip",
        fileSize: 128,
        fileLastModified: 0,
        sourceKey: "users/owner/imports/job/source.zip",
        parsedCount: 0,
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );
  const run = async (items: ItemSeed[], jobId?: Id<"importJobs">) => {
    const job = jobId ?? (await newJob());
    await t.mutation(internal.dataImport.insertItems, {
      jobId: job,
      items: items.map((item, sourceIndex) => ({
        sourceIndex,
        status: "pending" as const,
        type: item.type ?? "text",
        ...item,
      })),
    });
    const itemIds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("importJobItems")
          .withIndex("by_job_source", (q) => q.eq("jobId", job))
          .collect()
      ).map((item) => item._id)
    );
    const result = await t.mutation(internal.dataImport.createPendingBatch, {
      jobId: job,
      itemIds,
    });
    return { job, result };
  };
  const cards = () =>
    t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "owner"))
        .collect()
    );
  const folders = () =>
    t.run(async (ctx) => {
      const rows = await ctx.db
        .query("folders")
        .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", "owner"))
        .collect();
      return await Promise.all(
        rows.map(async (folder) => ({
          ...folder,
          activeCardCount: await readFolderCardCount(ctx, folder),
        }))
      );
    });
  const cardByContent = async (content: string) =>
    (await cards()).find((card) => card.content === content);
  return { t, run, cards, folders, cardByContent };
};

describe("schema v2 archive import", () => {
  test("restores folders, archive state, and titles", async () => {
    const { t, run, folders, cardByContent } = await setup();
    await run([
      {
        content: "Archived note",
        isArchived: true,
        metadataTitle: "A kept title",
        folders: ["Reading", 'Design, "refs"'],
      },
      { content: "Plain note", folders: ["reading"] },
      { content: "Loose note" },
    ]);

    const all = await folders();
    expect(all.map((folder) => folder.name).sort()).toEqual([
      'Design, "refs"',
      "Reading",
    ]);
    const reading = all.find((folder) => folder.name === "Reading");

    const archived = await cardByContent("Archived note");
    expect(archived?.isArchived).toBe(true);
    expect(typeof archived?.archivedAt).toBe("number");
    expect(archived?.metadataTitle).toBe("A kept title");
    expect(archived?.folderIds).toHaveLength(2);

    const plain = await cardByContent("Plain note");
    expect(plain?.folderIds).toEqual([reading?._id]);
    expect(plain?.isArchived).toBeUndefined();
    expect((await cardByContent("Loose note"))?.folderIds).toBeUndefined();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run((ctx) => ctx.db.query("folderCards").collect());
    expect(rows).toHaveLength(3);
    const refreshed = await folders();
    expect(
      refreshed.find((folder) => folder.name === "Reading")?.activeCardCount
    ).toBe(1);
  });

  test("restores when a link was marked done, and only on a link", async () => {
    const { run, cardByContent } = await setup();
    await run([
      {
        type: "link",
        content: "https://example.com/book",
        url: "https://example.com/book",
        importedCompletedAt: 1_780_000_000_000,
      },
      { content: "A note", importedCompletedAt: 1_780_000_000_000 },
      {
        type: "link",
        content: "https://example.com/film",
        url: "https://example.com/film",
      },
    ]);
    expect((await cardByContent("https://example.com/book"))?.completedAt).toBe(
      1_780_000_000_000
    );
    expect((await cardByContent("A note"))?.completedAt).toBeUndefined();
    expect(
      (await cardByContent("https://example.com/film"))?.completedAt
    ).toBeUndefined();
  });

  test("reuses the user's folders and skips smart ones", async () => {
    const { t, run, folders, cardByContent } = await setup();
    const existing = await t.run((ctx) => insertFolder(ctx, "owner", "Inbox"));
    await t.run((ctx) =>
      insertFolder(ctx, "owner", "Moodboard", undefined, 1, "type:image")
    );
    await run([{ content: "Note", folders: ["INBOX", "Moodboard"] }]);
    expect((await folders()).map((folder) => folder.name).sort()).toEqual([
      "Inbox",
      "Moodboard",
    ]);
    expect((await cardByContent("Note"))?.folderIds).toEqual([existing]);
  });

  test("a second import of the same archive makes no new folders", async () => {
    const { run, folders } = await setup();
    await run([{ content: "One", folders: ["Trips"] }]);
    await run([{ content: "Two", folders: ["Trips"] }]);
    expect((await folders()).map((folder) => folder.name)).toEqual(["Trips"]);
  });

  test("past the folder cap, the card imports without the new folder", async () => {
    const { t, run, cardByContent, folders } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 500; index++) {
        await insertFolder(ctx, "owner", `F${index}`);
      }
    });
    await run([{ content: "Capped", folders: ["F7", "Brand new"] }]);
    const card = await cardByContent("Capped");
    expect(card?.folderIds).toHaveLength(1);
    expect(await folders()).toHaveLength(500);
  });

  test("at the card cap, refused cards leave no folders behind", async () => {
    const { t, run, folders } = await setup();
    await t.run((ctx) =>
      insertCompletedCards(
        ctx,
        "owner",
        Array.from({ length: 199 }, (_, index) => ({
          type: "text" as const,
          content: `Existing ${index}`,
        }))
      )
    );
    const { job, result } = await run([
      { content: "Fits", isArchived: true, folders: ["Kept"] },
      { content: "Over", folders: ["Never made"] },
    ]);
    expect(result).toEqual({ limitReached: true });
    expect((await folders()).map((folder) => folder.name)).toEqual(["Kept"]);
    const items = await t.run((ctx) =>
      ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) => q.eq("jobId", job))
        .collect()
    );
    expect(items.map((item) => item.status)).toEqual(["created", "failed"]);
  });

  test("other sources keep archive state and folders, not archive titles", async () => {
    const { run, cardByContent, folders } = await setup("pocket");
    await run([
      {
        type: "link",
        content: "My bookmark",
        url: "https://example.com/",
        isArchived: true,
        metadataTitle: "Not used",
        folders: ["Work / Design"],
      },
      {
        type: "link",
        content: "Second",
        url: "https://example.com/2",
        folders: ["work / design"],
      },
    ]);
    const card = await cardByContent("My bookmark");
    expect(card?.isArchived).toBe(true);
    expect(card?.metadataTitle).toBe("My bookmark");
    expect((await folders()).map((folder) => folder.name)).toEqual([
      "Work / Design",
    ]);
    expect((await cardByContent("Second"))?.folderIds).toEqual(card?.folderIds);
  });
});
