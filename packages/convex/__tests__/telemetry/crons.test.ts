import { describe, expect, mock, test } from "bun:test";
import { type FunctionReference, getFunctionName } from "convex/server";
import { CRONS, cronTasksOn } from "../../cronSchedules";
import crons from "../../crons";
import { monitored, workosEventCatchUp } from "../../telemetry/crons";
import { handlerOf, mockActionCtx } from "../helpers/convex.test-utils";

const HEARTBEAT = "adminHealth:recordCronRun";

const recordMutations = (
  impl: (
    reference: FunctionReference<"mutation", "internal">,
    args?: unknown
  ) => Promise<unknown> = async () => null
) => mock(impl);

type RecordedMutations = ReturnType<typeof recordMutations>;

const heartbeatsOf = (runMutation: RecordedMutations) =>
  runMutation.mock.calls
    .filter(([reference]) => getFunctionName(reference) === HEARTBEAT)
    .map(([, args]) => args);

describe("cron monitoring", () => {
  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(slugs).toHaveLength(15);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("routes every schedule to its monitored Node action", () => {
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

  test("records a heartbeat when a job starts and when it finishes", async () => {
    const runMutation = recordMutations();
    expect(
      await handlerOf(workosEventCatchUp)(mockActionCtx({ runMutation }), {})
    ).toBeNull();
    expect(heartbeatsOf(runMutation)).toEqual([
      { name: "workos-event-catch-up", phase: "started" },
      { name: "workos-event-catch-up", phase: "succeeded" },
    ]);
  });

  test("records the error of a failed job and still rethrows it", async () => {
    const runMutation = recordMutations();
    await expect(
      monitored(mockActionCtx({ runMutation }), "workos-event-catch-up", () =>
        Promise.reject(new Error("events unavailable"))
      )
    ).rejects.toThrow("events unavailable");
    expect(heartbeatsOf(runMutation).at(-1)).toEqual({
      name: "workos-event-catch-up",
      phase: "failed",
      error: "events unavailable",
    });
  });

  test("a failed heartbeat write never fails the job", async () => {
    const runMutation = recordMutations(() =>
      Promise.reject(new Error("heartbeat table unavailable"))
    );
    expect(
      await handlerOf(workosEventCatchUp)(mockActionCtx({ runMutation }), {})
    ).toBeNull();
  });
});
