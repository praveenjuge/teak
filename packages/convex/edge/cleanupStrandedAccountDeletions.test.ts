import { ApiKeys } from "@vllnt/convex-api-keys";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { components, internal } from "../_generated/api";
import schema from "../schema";
import { buildR2UserPrefix } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");

const STRANDED = "stranded-owner";
const CURRENT = "current-owner";
const LIVE = "live-owner";

const setup = async () => {
  const t = convexTest(schema, modules);
  apiKeysTest.register(t);
  const keys = new ApiKeys(components.apiKeys);
  await t.run(async (ctx) => {
    for (const userId of [STRANDED, CURRENT, LIVE]) {
      await ctx.db.insert("accountDeletionStates", {
        userId,
        startedAt: 1,
        ...(userId === CURRENT ? { generation: 1, stage: 0 } : {}),
      });
      await keys.create(ctx, {
        env: "live",
        name: "Default API key",
        ownerId: userId,
        scopes: ["full_access"],
        type: "secret",
      });
    }
    await ctx.db.insert("users", {
      teakUserId: STRANDED,
      email: "",
      emailVerified: true,
      deletedAt: 1,
    });
    await ctx.db.insert("users", {
      teakUserId: LIVE,
      email: "live@example.org",
      emailVerified: true,
    });
    const prefix = buildR2UserPrefix(STRANDED);
    const exportJobId = await ctx.db.insert("exportJobs", {
      userId: STRANDED,
      status: "expired",
      artifactKey: `${prefix}/exports/export.zip`,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("accountStorageObjects", {
      userId: STRANDED,
      key: `${prefix}/cards/card-1/file.png`,
    });
    await ctx.db.insert("accountStorageObjects", {
      userId: STRANDED,
      key: `${prefix}/exports/export.zip`,
      exportJobId,
    });
  });
  const activeKeys = (ownerId: string) =>
    t.run((ctx) => keys.list(ctx, { ownerId, status: "active" }));
  const run = (dryRun?: boolean) =>
    t.mutation(
      internal["migration/cleanupStrandedAccountDeletions"]
        .cleanupStrandedAccountDeletions,
      { dryRun, once: true }
    );
  return { t, activeKeys, run, prefix: buildR2UserPrefix(STRANDED) };
};

describe("cleanupStrandedAccountDeletions", () => {
  test("a dry run counts the stranded account and changes nothing", async () => {
    const { t, activeKeys, run } = await setup();

    const result = await run();

    expect(result.dryRun).toBe(true);
    expect(result.totals).toEqual({
      examined: 3,
      skippedCurrent: 1,
      skippedLiveUser: 1,
      skippedHasCards: 0,
      apiKeysRevoked: 1,
      exportJobsDeleted: 1,
      exportJobItemsDeleted: 0,
      storageObjectsDeleted: 2,
      objectKeysQueued: 4,
      statesDeleted: 1,
      statesIncomplete: 0,
    });
    expect(await activeKeys(STRANDED)).toHaveLength(1);
    const remaining = await t.run(async (ctx) => ({
      states: (await ctx.db.query("accountDeletionStates").collect()).length,
      exports: (await ctx.db.query("exportJobs").collect()).length,
      objects: (await ctx.db.query("accountStorageObjects").collect()).length,
      dispatches: (await ctx.db.query("workflowDispatches").collect()).length,
    }));
    expect(remaining).toEqual({
      states: 3,
      exports: 1,
      objects: 2,
      dispatches: 0,
    });
  });

  test("a real run clears the stranded account and leaves the others", async () => {
    const { t, activeKeys, run, prefix } = await setup();

    const result = await run(false);

    expect(result.totals).toMatchObject({
      apiKeysRevoked: 1,
      statesDeleted: 1,
      objectKeysQueued: 4,
    });
    expect(await activeKeys(STRANDED)).toHaveLength(0);
    expect(await activeKeys(CURRENT)).toHaveLength(1);
    expect(await activeKeys(LIVE)).toHaveLength(1);
    const after = await t.run(async (ctx) => ({
      states: (await ctx.db.query("accountDeletionStates").collect())
        .map((state) => state.userId)
        .sort(),
      exports: await ctx.db.query("exportJobs").collect(),
      objects: await ctx.db.query("accountStorageObjects").collect(),
      dispatches: await ctx.db.query("workflowDispatches").collect(),
    }));
    expect(after.states).toEqual([CURRENT, LIVE]);
    expect(after.exports).toEqual([]);
    expect(after.objects).toEqual([]);
    expect(after.dispatches).toMatchObject([
      {
        kind: "deleteObjects",
        keys: expect.arrayContaining([
          `${prefix}/cards/card-1/file.png`,
          `${prefix}/exports/export.zip`,
          `${prefix}/exports/export.zip.checkpoint.json`,
          `${prefix}/exports/export.zip.result.json`,
        ]),
      },
    ]);

    const again = await run(false);
    expect(again.totals).toMatchObject({ examined: 2, statesDeleted: 0 });
  });
});
