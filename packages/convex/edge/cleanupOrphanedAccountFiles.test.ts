import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { buildR2UserPrefix } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");

const LIVE = "live-owner";
const DELETED = "deleted-owner";
const NO_ROW = "no-row-owner";
const DELETING = "deleting-owner";
const OWNERS = [LIVE, DELETED, NO_ROW, DELETING];

const setup = async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: LIVE,
      email: "live@example.org",
      emailVerified: true,
    });
    await ctx.db.insert("users", {
      teakUserId: DELETED,
      email: "",
      emailVerified: true,
      deletedAt: 1,
    });
    await ctx.db.insert("accountDeletionStates", {
      userId: DELETING,
      startedAt: 1,
      generation: 1,
      stage: 0,
    });
    for (const userId of OWNERS) {
      const prefix = buildR2UserPrefix(userId);
      const jobId = await ctx.db.insert("exportJobs", {
        userId,
        status: "expired",
        artifactKey: `${prefix}/exports/export.zip`,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("accountStorageObjects", {
        userId,
        key: `${prefix}/cards/card-1/file.png`,
      });
      await ctx.db.insert("accountStorageObjects", {
        userId,
        key: `${prefix}/exports/export.zip`,
        exportJobId: jobId,
      });
    }
  });
  const run = async (dryRun?: boolean) => ({
    exports: await t.mutation(
      internal["migration/cleanupOrphanedAccountFiles"].cleanupOrphanedExports,
      { dryRun, once: true }
    ),
    objects: await t.mutation(
      internal["migration/cleanupOrphanedAccountFiles"]
        .cleanupOrphanedStorageObjects,
      { dryRun, once: true }
    ),
  });
  const owners = () =>
    t.run(async (ctx) => ({
      exports: (await ctx.db.query("exportJobs").collect())
        .map((row) => row.userId)
        .sort(),
      objects: [
        ...new Set(
          (await ctx.db.query("accountStorageObjects").collect()).map(
            (row) => row.userId
          )
        ),
      ].sort(),
    }));
  return { t, run, owners };
};

describe("cleanupOrphanedAccountFiles", () => {
  test("a dry run counts files of accounts that are gone and changes nothing", async () => {
    const { t, run, owners } = await setup();

    const { exports, objects } = await run();

    expect(exports.totals).toMatchObject({
      examined: 4,
      skippedLiveOwner: 1,
      skippedDeleting: 1,
      exportJobsDeleted: 2,
      objectKeysQueued: 6,
    });
    expect(objects.totals).toMatchObject({
      examined: 8,
      skippedLiveOwner: 2,
      skippedDeleting: 2,
      storageObjectsDeleted: 4,
      objectKeysQueued: 4,
    });
    expect(await owners()).toEqual({
      exports: [...OWNERS].sort(),
      objects: [...OWNERS].sort(),
    });
    expect(
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).toEqual([]);
  });

  test("a real run removes them and queues their files", async () => {
    const { t, run, owners } = await setup();

    await run(false);

    const kept = [DELETING, LIVE].sort();
    expect(await owners()).toEqual({ exports: kept, objects: kept });
    const queued = (
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).flatMap((row) => (row.kind === "deleteObjects" ? (row.keys ?? []) : []));
    for (const userId of [DELETED, NO_ROW]) {
      const prefix = buildR2UserPrefix(userId);
      expect(queued).toEqual(
        expect.arrayContaining([
          `${prefix}/exports/export.zip`,
          `${prefix}/exports/export.zip.result.json`,
          `${prefix}/cards/card-1/file.png`,
        ])
      );
    }
    for (const userId of kept) {
      expect(
        queued.some((key) => key.startsWith(buildR2UserPrefix(userId)))
      ).toBe(false);
    }

    const again = await run(false);
    expect(again.exports.totals.exportJobsDeleted).toBe(0);
    expect(again.objects.totals.storageObjectsDeleted).toBe(0);
  });
});
