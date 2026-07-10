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
        schedule: "*/15 * * * *",
        slug: "ensure-oauth-clients",
      }),
    ]);
  });

  test("routes all five schedules through monitored Node actions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../crons.ts"),
      "utf8"
    );
    expect(source.match(/crons\.cron\(/gu)).toHaveLength(5);
    expect(source.match(/telemetry\.crons\./gu)).toHaveLength(5);
    expect(source).not.toContain("crons.daily(");
    expect(source).not.toContain("crons.interval(");
  });
});
