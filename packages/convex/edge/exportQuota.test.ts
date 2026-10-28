import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = "export-quota-owner";

const DAY_MS = 24 * 60 * 60 * 1000;

test("an export within 7 days stays refused however many exports were canceled since", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("exportJobs", {
      userId: OWNER,
      status: "ready",
      cancelRequested: false,
      quotaCountedAt: now - DAY_MS,
      completedAt: now - DAY_MS,
      expiresAt: now + 6 * DAY_MS,
      createdAt: now - DAY_MS,
      updatedAt: now - DAY_MS,
    });
    // Starting and canceling an export repeatedly leaves one row each.
    for (let index = 0; index < 60; index += 1) {
      await ctx.db.insert("exportJobs", {
        userId: OWNER,
        status: "canceled",
        cancelRequested: true,
        failureClass: "canceled",
        createdAt: now - DAY_MS + 1000 + index,
        updatedAt: now - DAY_MS + 1000 + index,
      });
    }
  });

  const latest = await t.query(internal.dataExport.getLatestExportForUser, {
    userId: OWNER,
  });
  expect(latest.canStartNew).toBe(false);
  expect(latest.quotaResetMs).toBeGreaterThan(5 * DAY_MS);

  const started = await t.mutation(internal.dataExport.startExportForUser, {
    userId: OWNER,
  });
  expect(started).toMatchObject({ started: false, reason: "quota_exceeded" });
});
