/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { queuedObjectDeletions } from "./__tests__/helpers/objectDeletions.test-utils";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

describe("maintenance queries", () => {
  test("AI backfill returns only old active cards missing every AI field", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 10 * 60 * 1000;
    const ids = await t.run(async (ctx) => ({
      activeFalse: await insertCard(ctx, {
        createdAt: old,
        isDeleted: false,
      }),
      activeUnset: await insertCard(ctx, { createdAt: old }),
      deleted: await insertCard(ctx, {
        createdAt: old,
        isDeleted: true,
      }),
      hasSummary: await insertCard(ctx, {
        aiSummary: "done",
        createdAt: old,
      }),
      hasTags: await insertCard(ctx, {
        aiTags: ["done"],
        createdAt: old,
      }),
      hasTranscript: await insertCard(ctx, {
        aiTranscript: "done",
        createdAt: old,
      }),
      recent: await insertCard(ctx),
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
        await insertCard(ctx, {
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
