import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORPHAN_NAME = "workflows/manager:cleanupCompletedWorkflow";
const LIVE_NAME =
  "migration/cancelOrphanedWorkflowCleanupJobs:cancelOrphanedWorkflowCleanupJobs";

const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;

const scheduleJob = (t: Backend, name: string) =>
  t.run((ctx) =>
    ctx.scheduler.runAfter(
      60 * 60 * 1000,
      makeFunctionReference<"mutation">(name),
      { generationNumber: 0, workflowId: "wf_test" }
    )
  );

const jobStates = (t: Backend) =>
  t.run(async (ctx) =>
    (
      await ctx.db.system.query("_scheduled_functions").collect()
    ).map((job) => ({ _id: job._id, name: job.name, kind: job.state.kind }))
  );

const runMigration = (
  t: Backend,
  args: {
    dryRun?: boolean;
    batchSize?: number;
    once?: boolean;
    cursor?: string | null;
  } = {}
) =>
  t.mutation(
    internal["migration/cancelOrphanedWorkflowCleanupJobs"]
      .cancelOrphanedWorkflowCleanupJobs,
    args
  );

describe("cancelOrphanedWorkflowCleanupJobs", () => {
  test("dry run counts the orphan and leaves it pending", async () => {
    const t = setup();
    await scheduleJob(t, ORPHAN_NAME);
    await scheduleJob(t, LIVE_NAME);

    const result = await runMigration(t, { once: true });

    expect(result.dryRun).toBe(true);
    expect(result.totals).toEqual({
      examined: 2,
      pending: 2,
      orphaned: 1,
      canceled: 0,
    });
    expect(result.pendingByFunction).toEqual({
      [ORPHAN_NAME]: 1,
      [LIVE_NAME]: 1,
    });
    const states = await jobStates(t);
    expect(states.map((job) => job.kind)).toEqual(["pending", "pending"]);
  });

  test("cancels pending jobs for the deleted module only", async () => {
    const t = setup();
    await scheduleJob(t, ORPHAN_NAME);
    await scheduleJob(t, ORPHAN_NAME);
    await scheduleJob(t, LIVE_NAME);

    const result = await runMigration(t, { dryRun: false, once: true });

    expect(result.totals).toEqual({
      examined: 3,
      pending: 3,
      orphaned: 2,
      canceled: 2,
    });
    const states = await jobStates(t);
    expect(
      states.find((job) => job.name === LIVE_NAME)?.kind
    ).toBe("pending");
    expect(
      states
        .filter((job) => job.name === ORPHAN_NAME)
        .map((job) => job.kind)
    ).toEqual(["canceled", "canceled"]);
  });

  test("skips jobs that are not pending", async () => {
    const t = setup();
    const jobId: Id<"_scheduled_functions"> = await scheduleJob(t, ORPHAN_NAME);
    await t.run((ctx) => ctx.scheduler.cancel(jobId));

    const result = await runMigration(t, { dryRun: false, once: true });

    expect(result.totals).toEqual({
      examined: 1,
      pending: 0,
      orphaned: 0,
      canceled: 0,
    });
    const states = await jobStates(t);
    expect(states).toEqual([
      { _id: jobId, name: ORPHAN_NAME, kind: "canceled" },
    ]);
  });

  test("schedules a continuation while pages remain", async () => {
    const t = setup();
    await scheduleJob(t, ORPHAN_NAME);
    await scheduleJob(t, ORPHAN_NAME);

    const first = await runMigration(t, {
      dryRun: false,
      batchSize: 1,
    });

    expect(first.isDone).toBe(false);
    expect(first.continuationScheduled).toBe(true);
    expect(first.continueCursor).not.toBeNull();
    expect(first.totals.canceled).toBe(1);
    const states = await jobStates(t);
    const continuation = states.find((job) => job.name === LIVE_NAME);
    expect(continuation?.kind).toBe("pending");

    const second = await runMigration(t, {
      dryRun: false,
      batchSize: 10,
      cursor: first.continueCursor,
    });
    expect(second.totals.orphaned).toBeGreaterThanOrEqual(1);
  });
});
