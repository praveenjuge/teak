// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import {
  CRON_MONITORS,
  cleanupExpiredIdempotency,
  cleanupExpiredNativeAuthCodes,
} from "../../telemetry/crons";

describe("Sentry cron monitoring", () => {
  test.each([
    ["idempotency", cleanupExpiredIdempotency],
    ["nativeAuthCodes", cleanupExpiredNativeAuthCodes],
  ])(
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

  test("defines one bounded monitor for each scheduled job", () => {
    expect(Object.values(CRON_MONITORS)).toEqual([
      expect.objectContaining({
        schedule: "10 * * * *",
        slug: "cleanup-expired-idempotency",
      }),
      expect.objectContaining({
        schedule: "30 6 * * *",
        slug: "cleanup-expired-native-auth-codes",
      }),
      expect.objectContaining({
        schedule: "0 */6 * * *",
        slug: "ai-metadata-backfill",
      }),
      expect.objectContaining({
        schedule: "0 * * * *",
        slug: "cleanup-abandoned-import-uploads",
      }),
      expect.objectContaining({
        schedule: "0 3 * * *",
        slug: "cleanup-expired-exports",
      }),
      expect.objectContaining({
        schedule: "0 2 * * *",
        slug: "cleanup-old-deleted-cards",
      }),
      expect.objectContaining({
        schedule: "30 * * * *",
        slug: "cleanup-stale-pending-card-uploads",
      }),
      expect.objectContaining({
        schedule: "0 4 * * 1",
        slug: "sweep-orphaned-objects",
      }),
      expect.objectContaining({
        checkinMarginMinutes: 30,
        schedule: "0 5 * * 1",
        slug: "reap-stuck-workflows",
      }),
      expect.objectContaining({
        schedule: "0 6 * * *",
        slug: "cleanup-resend-emails",
      }),
      expect.objectContaining({
        checkinMarginMinutes: 15,
        failureIssueThreshold: 1,
        schedule: "0 1 * * *",
        slug: "ensure-oauth-clients",
      }),
      expect.objectContaining({
        schedule: "*/5 * * * *",
        slug: "redrive-account-deletion",
        failureIssueThreshold: 2,
      }),
    ]);
  });

  test("only sub-hourly monitors tolerate a single failed check-in", () => {
    const runsMoreThanHourly = (schedule: string) => {
      const [minute, hour] = schedule.split(" ");
      return (
        hour === "*" &&
        (minute === "*" || minute.includes("/") || minute.includes(","))
      );
    };
    const monitors = Object.values(CRON_MONITORS);
    const tolerant = monitors
      .filter((monitor) => (monitor.failureIssueThreshold ?? 1) > 1)
      .map((monitor) => monitor.slug);
    const subHourly = monitors
      .filter((monitor) => runsMoreThanHourly(monitor.schedule))
      .map((monitor) => monitor.slug);
    expect(subHourly).toEqual(["redrive-account-deletion"]);
    expect(tolerant).toEqual(subHourly);
  });

  test("routes all twelve schedules through monitored Node actions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../crons.ts"),
      "utf8"
    );
    expect(source.match(/crons\.cron\(/gu)).toHaveLength(12);
    expect(source.match(/telemetry\.crons\./gu)).toHaveLength(12);
    expect(source).not.toContain("crons.daily(");
    expect(source).not.toContain("crons.interval(");
  });
});
