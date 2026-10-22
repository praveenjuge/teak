import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRONS, cronTasksOn } from "../cronSchedules";
import crons from "../crons";

const EXPECTED_SCHEDULES: Record<string, string> = {
  "workos-event-catch-up": "15 * * * *",
  "workflow-dispatch-watchdog": "35 * * * *",
};

const WORKER_DIR = join(import.meta.dir, "../../../apps/files-worker");
const WRANGLER_CONFIGS = [
  join(WORKER_DIR, "wrangler.jsonc"),
  join(WORKER_DIR, "development/wrangler.jsonc"),
];

const triggerCrons = (path: string): string[] =>
  (
    Bun.JSONC.parse(readFileSync(path, "utf-8")) as {
      triggers?: { crons?: string[] };
    }
  ).triggers?.crons ?? [];

describe("crons.ts", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(slugs).toHaveLength(15);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("registers exactly the expected jobs on their schedules", () => {
    expect(
      Object.fromEntries(
        Object.entries(crons.crons).map(([identifier, job]) => [
          identifier,
          job.schedule.type === "cron" ? job.schedule.cron : job.schedule,
        ])
      )
    ).toEqual(EXPECTED_SCHEDULES);
  });

  test("routes every Convex schedule to its monitored Node action, never a Files Worker task", () => {
    expect(crons.crons).toEqual(
      Object.fromEntries(
        cronTasksOn("convex").map((handler) => [
          CRONS[handler].name,
          {
            name: `telemetry/crons:${handler}`,
            args: [{}],
            schedule: { cron: CRONS[handler].schedule, type: "cron" },
          },
        ])
      )
    );
  });

  test.each(WRANGLER_CONFIGS)(
    "the Cloudflare tasks' schedules are exactly the Cron Triggers in %s",
    (path) => {
      const schedules = new Set(
        cronTasksOn("cloudflare").map((task) => CRONS[task].schedule)
      );
      expect([...new Set(triggerCrons(path))].sort()).toEqual(
        [...schedules].sort()
      );
    }
  );
});
