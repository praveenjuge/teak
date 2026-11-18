import { describe, expect, test } from "bun:test";
import { CRONS } from "../cronSchedules";
import crons from "../crons";

describe("crons.ts", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("schedules only the dispatch watchdog on Convex, through its monitored Node action", () => {
    expect(crons.crons).toEqual({
      "workflow-dispatch-watchdog": {
        name: "telemetry/crons:workflowDispatchWatchdog",
        args: [{}],
        schedule: { cron: "35 * * * *", type: "cron" },
      },
    });
  });
});
