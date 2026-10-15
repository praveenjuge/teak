// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { CRONS } from "../../cronSchedules";
import crons from "../../crons";
import {
  cleanupExpiredIdempotency,
  cleanupOldDeletedCards,
} from "../../telemetry/crons";

const HEARTBEAT = "adminHealth:recordCronRun";

// Every monitored cron also writes heartbeats; these tests look at the job.
const jobCalls = (runMutation) =>
  runMutation.mock.calls.filter(
    ([reference]) => getFunctionName(reference) !== HEARTBEAT
  );

describe("cron monitoring", () => {
  test.each([["idempotency", cleanupExpiredIdempotency]])(
    "retention cron %s runs only with explicit activation",
    async (kind, action) => {
      const previous = process.env.OPERATIONAL_RETENTION_ENABLED;
      const runMutation = mock(async () => null);
      try {
        for (const flag of [undefined, "false", "TRUE"]) {
          if (flag === undefined) {
            delete process.env.OPERATIONAL_RETENTION_ENABLED;
          } else {
            process.env.OPERATIONAL_RETENTION_ENABLED = flag;
          }
          expect(await action._handler({ runMutation }, {})).toBeNull();
          expect(jobCalls(runMutation)).toHaveLength(0);
        }
        process.env.OPERATIONAL_RETENTION_ENABLED = "true";
        expect(await action._handler({ runMutation }, {})).toBeNull();
        expect(jobCalls(runMutation)).toHaveLength(1);
        const [reference, args] = jobCalls(runMutation)[0];
        expect(getFunctionName(reference)).toBe(
          "operationalRetention:cleanupExpiredRecords"
        );
        expect(args).toEqual({ kind, dryRun: false });
      } finally {
        if (previous === undefined) {
          delete process.env.OPERATIONAL_RETENTION_ENABLED;
        } else {
          process.env.OPERATIONAL_RETENTION_ENABLED = previous;
        }
      }
    }
  );

  test("the daily deleted-card cleanup also prunes expired card tombstones", async () => {
    const runMutation = mock(async () => null);
    expect(
      await cleanupOldDeletedCards._handler({ runMutation }, {})
    ).toBeNull();
    expect(
      jobCalls(runMutation).map(([reference, args]) => [
        getFunctionName(reference),
        args,
      ])
    ).toEqual([
      ["workflows/cardCleanup:startCardCleanupWorkflow", {}],
      ["publicApiTombstones:pruneExpiredCardTombstones", {}],
    ]);
  });

  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(slugs).toHaveLength(11);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("routes every schedule to its monitored Node action", () => {
    expect(crons.crons).toEqual(
      Object.fromEntries(
        Object.entries(CRONS).map(([handler, { name, schedule }]) => [
          name,
          {
            name: `telemetry/crons:${handler}`,
            args: [{}],
            schedule: { cron: schedule, type: "cron" },
          },
        ])
      )
    );
  });

  test("records a heartbeat when a job starts and when it finishes", async () => {
    const runMutation = mock(async () => null);
    await cleanupOldDeletedCards._handler({ runMutation }, {});
    expect(
      runMutation.mock.calls
        .filter(([reference]) => getFunctionName(reference) === HEARTBEAT)
        .map(([, args]) => args)
    ).toEqual([
      { name: "cleanup-old-deleted-cards", phase: "started" },
      { name: "cleanup-old-deleted-cards", phase: "succeeded" },
    ]);
  });

  test("records the error of a failed job and still rethrows it", async () => {
    const heartbeats: unknown[] = [];
    const runMutation = mock((reference, args) => {
      if (getFunctionName(reference) === HEARTBEAT) {
        heartbeats.push(args);
        return Promise.resolve(null);
      }
      return Promise.reject(new Error("workflow start failed"));
    });
    await expect(
      cleanupOldDeletedCards._handler({ runMutation }, {})
    ).rejects.toThrow("workflow start failed");
    expect(heartbeats.at(-1)).toEqual({
      name: "cleanup-old-deleted-cards",
      phase: "failed",
      error: "workflow start failed",
    });
  });

  test("a failed heartbeat write never fails the job", async () => {
    const runMutation = mock((reference) =>
      getFunctionName(reference) === HEARTBEAT
        ? Promise.reject(new Error("heartbeat table unavailable"))
        : Promise.resolve(null)
    );
    expect(
      await cleanupOldDeletedCards._handler({ runMutation }, {})
    ).toBeNull();
  });
});
