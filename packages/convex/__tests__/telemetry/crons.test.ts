// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import {
  CRON_MONITORS,
  cleanupExpiredIdempotency,
  cleanupOldDeletedCards,
} from "../../telemetry/crons";

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
          expect(runMutation).not.toHaveBeenCalled();
        }
        process.env.OPERATIONAL_RETENTION_ENABLED = "true";
        expect(await action._handler({ runMutation }, {})).toBeNull();
        expect(runMutation).toHaveBeenCalledTimes(1);
        const [reference, args] = runMutation.mock.calls[0];
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
      runMutation.mock.calls.map(([reference, args]) => [
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
});
