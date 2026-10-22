import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { syncCardSearch } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const insertCard = async (
  ctx: MutationCtx,
  overrides: Partial<Doc<"cards">> = {}
) =>
  await ctx.db.insert("cards", {
    content: "Card",
    createdAt: Date.now(),
    type: "text",
    updatedAt: Date.now(),
    userId: "maintenance-test-user",
    ...overrides,
  });

// A card saved through the app: its search sync sets `aiPending`.
const saveCard = async (
  ctx: MutationCtx,
  overrides: Partial<Doc<"cards">> = {}
) => {
  const cardId = await insertCard(ctx, overrides);
  await syncCardSearch(ctx, cardId);
  return cardId;
};

describe("maintenance queries", () => {
  test("AI backfill returns only old active cards missing every AI field", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 10 * 60 * 1000;
    const ids = await t.run(async (ctx) => ({
      activeFalse: await saveCard(ctx, {
        createdAt: old,
        isDeleted: false,
      }),
      activeUnset: await saveCard(ctx, { createdAt: old }),
      deleted: await saveCard(ctx, {
        createdAt: old,
        isDeleted: true,
      }),
      hasSummary: await saveCard(ctx, {
        aiSummary: "done",
        createdAt: old,
      }),
      hasTags: await saveCard(ctx, {
        aiTags: ["done"],
        createdAt: old,
      }),
      hasTranscript: await saveCard(ctx, {
        aiTranscriptCharCount: 4,
        createdAt: old,
      }),
      recent: await saveCard(ctx),
    }));

    const result = await t.query(internal["ai/queries"].findCardsMissingAi, {});
    expect(
      new Set(result.map(({ cardId }: { cardId: Id<"cards"> }) => cardId))
    ).toEqual(new Set([ids.activeFalse, ids.activeUnset]));
  });

  test("AI backfill stays capped at fifty cards", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 10 * 60 * 1000;
    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await saveCard(ctx, {
          content: `Card ${index}`,
          createdAt: old + index,
          isDeleted: index % 2 === 0 ? undefined : false,
        });
      }
    });

    const result = await t.query(internal["ai/queries"].findCardsMissingAi, {});
    expect(result).toHaveLength(50);
  });

  test("card cleanup returns only deleted cards inside the age range", async () => {
    const t = convexTest(schema, modules);
    const cutoff = Date.now();
    const ids = await t.run(async (ctx) => ({
      active: await insertCard(ctx, { deletedAt: 1 }),
      eligible: await insertCard(ctx, { deletedAt: 1, isDeleted: true }),
      future: await insertCard(ctx, {
        deletedAt: cutoff + 1,
        isDeleted: true,
      }),
      missingTimestamp: await insertCard(ctx, { isDeleted: true }),
    }));

    const result = await t.query(
      internal.card.trashCleanup.getCardsPendingCleanup,
      { limit: 10, olderThan: cutoff }
    );
    expect(result).toEqual([{ _id: ids.eligible }]);
  });
});

describe("orphan sweep references", () => {
  const SOURCES = [
    "uploads",
    "imports",
    "pendingLinkedPdfs",
    "failedLinkedPdfs",
    "exports",
  ] as const;

  test("pages every source one row at a time to every key rows still hold", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [index, extra] of [
        {},
        { reportKey: "users/u1/imports/report.csv" },
        {
          stagedItems: { cursor: null, offset: 0, pages: 1, part: 2, parts: 2 },
        },
      ].entries()) {
        await ctx.db.insert("importJobs", {
          createdAt: now,
          createdCount: 0,
          failedCount: 0,
          fileLastModified: now,
          fileName: "export.zip",
          fileSize: 10,
          mode: "archive",
          parsedCount: 0,
          phase: "Importing cards",
          processedCount: 0,
          skippedCount: 0,
          sourceKey: `users/u1/cards/pending/import-source/${index}.zip`,
          status: "importing",
          updatedAt: now,
          userId: "u1",
          ...extra,
        });
      }
      for (const artifactKey of [undefined, "users/u1/exports/a.zip"]) {
        await ctx.db.insert("exportJobs", {
          createdAt: now,
          status: "ready",
          updatedAt: now,
          userId: "u1",
          ...(artifactKey ? { artifactKey } : {}),
        });
      }
    });

    const paged: string[] = [];
    for (const source of SOURCES) {
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const result: {
          continueCursor: string;
          isDone: boolean;
          keys: string[];
        } = await t.query(
          internal.storage.orphanSweep.pageNonCardReferencedKeys,
          { cursor, numItems: 1, source }
        );
        paged.push(...result.keys);
        if (result.isDone) {
          break;
        }
        cursor = result.continueCursor;
      }
    }

    // Three import sources, a report, two staged parts and an export's three.
    expect(new Set(paged).size).toBe(9);
    expect(paged).toHaveLength(9);
    expect(paged).toEqual(
      expect.arrayContaining([
        "users/u1/cards/pending/import-source/0.zip",
        "users/u1/cards/pending/import-source/1.zip",
        "users/u1/cards/pending/import-source/2.zip",
        "users/u1/imports/report.csv",
        "users/u1/exports/a.zip",
        "users/u1/exports/a.zip.checkpoint.json",
        "users/u1/exports/a.zip.result.json",
      ])
    );
  });
});

describe("trash cleanup", () => {
  test("hard-deletes a card past retention, keeps a tombstone and queues its objects", async () => {
    const t = convexTest(schema, modules);
    const cutoff = Date.now();
    const fileKey = "users/maintenance/cards/old/file/a.png";
    const thumbnailKey = "users/maintenance/cards/old/thumbnail/a.webp";
    const ids = await t.run(async (ctx) => ({
      old: await insertCard(ctx, {
        deletedAt: cutoff - 1,
        fileKey,
        isDeleted: true,
        thumbnailKey,
        type: "image",
      }),
      recent: await insertCard(ctx, { deletedAt: cutoff + 1, isDeleted: true }),
    }));

    for (const [cardId, deleted] of [
      [ids.old, true],
      [ids.recent, false],
    ] as const) {
      expect(
        await t.mutation(internal.card.trashCleanup.cleanupDeletedCard, {
          cardId,
          cutoff,
        })
      ).toEqual({ deleted });
    }

    expect(await t.run((ctx) => ctx.db.get(ids.old))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.recent))).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("cardTombstones").collect())
    ).toMatchObject([{ cardId: ids.old }]);
    expect(await queuedObjectDeletions(t)).toEqual(
      expect.arrayContaining([fileKey, thumbnailKey])
    );
  });
});

describe("export jobs", () => {
  test("starting an export queues its run and records the instance", async () => {
    const t = convexTest(schema, modules);
    const started = await t.mutation(internal.dataExport.startExportForUser, {
      userId: "export-user",
    });
    const jobId = started.job?.id as Id<"exportJobs">;

    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "pending",
      workflowId: `export-${jobId}`,
    });
    expect(
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).toMatchObject([
      {
        instanceId: `export-${jobId}`,
        kind: "export",
        params: { jobId, userId: "export-user" },
        state: "pending",
      },
    ]);
  });

  test("a running job gets the archive key its run writes to", async () => {
    const t = convexTest(schema, modules);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("exportJobs", {
        createdAt: 1,
        status: "pending",
        updatedAt: 1,
        userId: "export-user",
      })
    );

    const running = await t.mutation(internal.dataExport.markRunning, {
      jobId,
      workflowId: `export-${jobId}`,
    });

    expect(running.canceled).toBe(false);
    expect(running.artifactKey).toMatch(
      new RegExp(
        `^exports/[0-9a-f]{16}/${jobId}-\\d{4}-\\d{2}-\\d{2}\\.zip$`,
        "u"
      )
    );
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "running",
    });
  });

  test("an archive that finishes after a cancel is queued for deletion, not offered", async () => {
    const t = convexTest(schema, modules);
    const artifactKey = "exports/0123456789abcdef/job-2026-10-16.zip";
    const jobId = await t.run((ctx) =>
      ctx.db.insert("exportJobs", {
        cancelRequested: true,
        createdAt: 1,
        status: "canceled",
        updatedAt: 1,
        userId: "export-user",
      })
    );

    await t.mutation(internal.dataExport.completeExport, {
      artifactBytes: 10,
      artifactKey,
      cardCount: 1,
      filesIncluded: 0,
      filesOmitted: 0,
      jobId,
    });

    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "canceled",
    });
    expect(
      (await t.run((ctx) => ctx.db.get(jobId)))?.artifactKey
    ).toBeUndefined();
    expect(await queuedObjectDeletions(t)).toEqual([
      artifactKey,
      `${artifactKey}.checkpoint.json`,
      `${artifactKey}.result.json`,
      `${artifactKey}.manifest.json`,
    ]);
  });
});

describe("export snapshot", () => {
  const seedExport = async (t: ReturnType<typeof convexTest>) =>
    await t.run(async (ctx) => {
      const userId = "export-user";
      const jobId = await ctx.db.insert("exportJobs", {
        createdAt: 1,
        status: "running",
        updatedAt: 1,
        userId,
      });
      const cards = {
        file: await insertCard(ctx, {
          createdAt: 5,
          fileKey: "users/export-user/cards/f/file/a.png",
          fileMetadata: { fileName: "a.png", fileSize: 300 },
          notes: "with a file",
          tags: ["design"],
          type: "image",
          userId,
        }),
        deleted: await insertCard(ctx, {
          createdAt: 4,
          isDeleted: true,
          userId,
        }),
        textWithKey: await insertCard(ctx, {
          content: "Plain text",
          createdAt: 3,
          fileKey: "users/export-user/cards/t/file/ignored.txt",
          fileMetadata: { fileName: "ignored.txt", fileSize: 999 },
          userId,
        }),
        link: await insertCard(ctx, {
          aiSummary: "A page",
          content: "https://example.com",
          createdAt: 2,
          isFavorited: true,
          type: "link",
          url: "https://example.com",
          userId,
        }),
        oldest: await insertCard(ctx, { createdAt: 1, userId }),
        otherUser: await insertCard(ctx, {
          createdAt: 6,
          userId: "someone-else",
        }),
      };
      return { cards, jobId };
    });

  const snapshotIds = async (
    t: ReturnType<typeof convexTest>,
    jobId: Id<"exportJobs">
  ) => {
    const ids: Id<"cards">[] = [];
    let addedBytes = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: {
        addedBytes: number;
        cardIds: Id<"cards">[];
        cursor: string | null;
        isDone: boolean;
      } = await t.query(internal.dataExport.getExportSnapshotPage, {
        cursor,
        jobId,
        numItems: 2,
      });
      ids.push(...page.cardIds);
      addedBytes += page.addedBytes;
      if (page.isDone) {
        return { addedBytes, ids };
      }
      cursor = page.cursor;
    }
  };

  test("an export snapshots its owner's live cards newest first without writing a row", async () => {
    const t = convexTest(schema, modules);
    const { cards, jobId } = await seedExport(t);

    const snapshot = await snapshotIds(t, jobId);

    expect(snapshot).toEqual({
      addedBytes: 300,
      ids: [cards.file, cards.textWithKey, cards.link, cards.oldest],
    });
    expect(
      await t.run((ctx) => ctx.db.query("exportJobItems").collect())
    ).toEqual([]);
  });

  test("cards read by id match what the row snapshot reads", async () => {
    const t = convexTest(schema, modules);
    const { jobId } = await seedExport(t);
    const { ids } = await snapshotIds(t, jobId);
    const byId = await t.query(internal.dataExport.getExportCardsByIds, {
      cardIds: ids,
      jobId,
    });

    let cursor: string | null = null;
    for (;;) {
      const page: { cursor: string | null; isDone: boolean } = await t.mutation(
        internal.dataExport.recordSnapshotPage,
        {
          cursor,
          jobId,
          numItems: 2,
        }
      );
      if (page.isDone) {
        break;
      }
      cursor = page.cursor;
    }
    const fromRows = await t.query(internal.dataExport.getExportCardsPage, {
      cursor: null,
      jobId,
      numItems: 100,
    });

    expect(byId).toEqual(fromRows.cards);
    expect(byId).toHaveLength(4);
    expect(byId[1]).toMatchObject({ content: "Plain text", type: "text" });
    expect(byId[1].fileKey).toBeUndefined();
  });

  test("cards read by id leave out ones deleted since and other accounts' cards", async () => {
    const t = convexTest(schema, modules);
    const { cards, jobId } = await seedExport(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(cards.link, { content: "edited", isDeleted: true });
      await ctx.db.patch(cards.oldest, { content: "edited since" });
      await ctx.db.delete(cards.textWithKey);
    });

    const read = await t.query(internal.dataExport.getExportCardsByIds, {
      cardIds: [
        cards.oldest,
        cards.otherUser,
        cards.link,
        cards.textWithKey,
        cards.file,
      ],
      jobId,
    });

    expect(read.map((row: { _id: string }) => row._id)).toEqual([
      cards.oldest,
      cards.file,
    ]);
    expect(read[0]).toMatchObject({ content: "edited since" });
  });
});
