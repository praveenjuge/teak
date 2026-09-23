// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRON_MONITORS } from "../../telemetry/crons";

describe("Sentry cron monitoring", () => {
  test("defines one bounded monitor for each scheduled job", () => {
    expect(Object.values(CRON_MONITORS)).toEqual([
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
        checkinMarginMinutes: 15,
        failureIssueThreshold: 2,
        schedule: "*/15 * * * *",
        slug: "ensure-oauth-clients",
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
    expect(subHourly).toEqual(["ensure-oauth-clients"]);
    expect(tolerant).toEqual(subHourly);
  });

  test("routes all eight schedules through monitored Node actions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../crons.ts"),
      "utf8"
    );
    expect(source.match(/crons\.cron\(/gu)).toHaveLength(8);
    expect(source.match(/telemetry\.crons\./gu)).toHaveLength(8);
    expect(source).not.toContain("crons.daily(");
    expect(source).not.toContain("crons.interval(");
  });
});
