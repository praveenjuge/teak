import { describe, expect, test } from "bun:test";
import { CRONS } from "../cronSchedules";
import crons from "../crons";

describe("crons.ts", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("schedules the dispatch watchdog and WorkOS auth failures on Convex, through monitored Node actions", () => {
    expect(crons.crons).toEqual({
      "workflow-dispatch-watchdog": {
        name: "telemetry/crons:workflowDispatchWatchdog",
        args: [{}],
        schedule: { cron: "35 * * * *", type: "cron" },
      },
      "workos-auth-failures": {
        name: "telemetry/crons:workosAuthFailures",
        args: [{}],
        schedule: { cron: "20 * * * *", type: "cron" },
      },
    });
  });
});
