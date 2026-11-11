import { describe, expect, test } from "bun:test";
import { CRONS, cronTasksOn } from "../cronSchedules";
import crons from "../crons";

describe("crons.ts", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(new Set(slugs).size).toBe(slugs.length);
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
