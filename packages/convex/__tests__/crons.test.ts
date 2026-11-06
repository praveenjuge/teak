import { describe, expect, test } from "bun:test";
import { CRONS, cronTasksOn } from "../cronSchedules";
import crons from "../crons";

const EXPECTED_SCHEDULES: Record<string, string> = {
  "workflow-dispatch-watchdog": "35 * * * *",
  "cleanup-finished-link-pastes": "25 3 * * *",
  "cleanup-expired-folder-rule-runs": "15 * * * *",
};

describe("crons.ts", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(slugs).toHaveLength(16);
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

  test("routes every Convex schedule to its monitored Node action, never a Core Worker task", () => {
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
});
