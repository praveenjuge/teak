/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { queueCardProcessing } from "./workflowDispatch";

const modules = import.meta.glob("./**/*.ts");
const NOW = new Date("2026-10-16T10:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const insertCard = (
  t: ReturnType<typeof convexTest>,
  overrides: {
    isDeleted?: boolean;
    metadata: "pending" | "in_progress" | "completed";
    updatedAt?: number;
  }
) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      content: "Card",
      createdAt: NOW - DAY_MS,
      ...(overrides.isDeleted ? { isDeleted: true } : {}),
      processingStatus: {
        classify: { status: "completed" },
        metadata: { status: overrides.metadata },
      },
      type: "text",
      updatedAt: overrides.updatedAt ?? NOW - DAY_MS,
      userId: "user-1",
    })
  );

describe("requeueUnfinishedCards", () => {
  test("queues a run for recent cards with an unfinished stage", async () => {
    const t = convexTest(schema, modules);
    const pending = await insertCard(t, { metadata: "pending" });
    const running = await insertCard(t, { metadata: "in_progress" });
    await insertCard(t, { metadata: "completed" });
    await insertCard(t, { isDeleted: true, metadata: "pending" });
    await insertCard(t, { metadata: "pending", updatedAt: NOW - 30 * DAY_MS });

    const dryRun = await t.mutation(
      internal.migration.cutoverWorkflows.requeueUnfinishedCards,
      { once: true }
    );
    expect(dryRun.batch).toEqual({ examined: 5, queued: 2, skippedOpenRun: 0 });
    expect(
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).toEqual([]);

    await t.mutation(
      internal.migration.cutoverWorkflows.requeueUnfinishedCards,
      { dryRun: false, once: true }
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("workflowDispatches").collect()
    );
    expect(rows.map((row) => row.cardId).sort()).toEqual(
      [pending, running].sort()
    );
    expect(rows.every((row) => row.kind === "cardProcessing")).toBe(true);
  });

  test("leaves cards that already have a run queued", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, { metadata: "pending" });
    await t.run((ctx) => queueCardProcessing(ctx, cardId));
    const result = await t.mutation(
      internal.migration.cutoverWorkflows.requeueUnfinishedCards,
      { dryRun: false, once: true }
    );
    expect(result.batch).toEqual({
      examined: 1,
      queued: 0,
      skippedOpenRun: 1,
    });
  });
});

describe("requeueJobs", () => {
  test("queues every export, import and account deletion still in flight", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const exportId = await ctx.db.insert("exportJobs", {
        createdAt: NOW,
        status: "running",
        updatedAt: NOW,
        userId: "user-1",
      });
      await ctx.db.insert("exportJobs", {
        createdAt: NOW,
        status: "ready",
        updatedAt: NOW,
        userId: "user-1",
      });
      const importId = await ctx.db.insert("importJobs", {
        createdAt: NOW,
        createdCount: 0,
        failedCount: 0,
        fileLastModified: NOW,
        fileName: "export.zip",
        fileSize: 1,
        mode: "archive",
        parsedCount: 0,
        phase: "Importing cards",
        processedCount: 0,
        skippedCount: 0,
        sourceKey: "users/u1/cards/pending/import-source/a.zip",
        status: "importing",
        updatedAt: NOW,
        userId: "user-2",
      });
      const stateId = await ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: 2,
        startedAt: NOW,
        userId: "user-3",
        workflowId: "old-convex-workflow-id",
      });
      // A bare marker without a run.
      await ctx.db.insert("accountDeletionStates", {
        startedAt: NOW,
        userId: "user-4",
      });
      return { exportId, importId, stateId };
    });

    const dryRun = await t.mutation(
      internal.migration.cutoverWorkflows.requeueJobs,
      {}
    );
    expect(dryRun).toMatchObject({
      accountDeletions: { queued: 1 },
      dryRun: true,
      exports: { queued: 1 },
      imports: { queued: 1 },
    });

    await t.mutation(internal.migration.cutoverWorkflows.requeueJobs, {
      dryRun: false,
    });
    const instanceIds = (
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    )
      .map((row) => row.instanceId)
      .sort();
    expect(instanceIds).toEqual(
      [
        `account-deletion-${ids.stateId}-1-${NOW}`,
        `export-${ids.exportId}`,
        `import-${ids.importId}`,
      ].sort()
    );
    const again = await t.mutation(
      internal.migration.cutoverWorkflows.requeueJobs,
      { dryRun: false }
    );
    expect(again).toMatchObject({
      accountDeletions: { queued: 0, skippedOpenRun: 1 },
      exports: { queued: 0, skippedOpenRun: 1 },
      imports: { queued: 0, skippedOpenRun: 1 },
    });
  });
});
