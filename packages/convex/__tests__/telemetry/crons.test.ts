// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import {
  CRON_MONITORS,
  cleanupExpiredIdempotency,
  cleanupOldDeletedCards,
  sweepOrphanedObjects,
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
    const slugs = Object.values(CRON_MONITORS);
    expect(slugs).toHaveLength(11);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("routes all eleven schedules through monitored Node actions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../crons.ts"),
      "utf8"
    );
    expect(source.match(/crons\.cron\(/gu)).toHaveLength(11);
    expect(source.match(/telemetry\.crons\./gu)).toHaveLength(11);
    expect(source).not.toContain("crons.daily(");
    expect(source).not.toContain("crons.interval(");
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

  test("the weekly sweep runs both reports even when the first one fails", async () => {
    const runMutation = mock(async () => null);
    const runAction = mock((reference) =>
      getFunctionName(reference) === "embedding/sweep:sweepVectorLedger"
        ? Promise.reject(new Error("ledger read limit"))
        : Promise.resolve({ orphanCount: 0 })
    );
    await expect(
      sweepOrphanedObjects._handler({ runAction, runMutation }, {})
    ).rejects.toThrow("ledger read limit");
    expect(
      runAction.mock.calls.map(([reference]) => getFunctionName(reference))
    ).toEqual([
      "embedding/sweep:sweepVectorLedger",
      "workflows/orphanSweep:sweepOrphanedObjects",
    ]);
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
