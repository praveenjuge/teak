import { describe, expect, mock, test } from "bun:test";
import { type FunctionReference, getFunctionName } from "convex/server";
import { CRONS } from "../../cronSchedules";
import { monitored } from "../../telemetry/crons";
import { mockActionCtx } from "../helpers/convex.test-utils";

const HEARTBEAT = "adminHealth:recordCronRun";
const JOB = CRONS.workflowDispatchWatchdog.name;

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
  test("records a heartbeat when a job starts and when it finishes", async () => {
    const runMutation = recordMutations();
    expect(
      await monitored(mockActionCtx({ runMutation }), JOB, async () => null)
    ).toBeNull();
    expect(heartbeatsOf(runMutation)).toEqual([
      { name: JOB, phase: "started" },
      { name: JOB, phase: "succeeded" },
    ]);
  });

  test("records the error of a failed job and still rethrows it", async () => {
    const runMutation = recordMutations();
    await expect(
      monitored(mockActionCtx({ runMutation }), JOB, () =>
        Promise.reject(new Error("dispatch health unavailable"))
      )
    ).rejects.toThrow("dispatch health unavailable");
    expect(heartbeatsOf(runMutation).at(-1)).toEqual({
      name: JOB,
      phase: "failed",
      error: "dispatch health unavailable",
    });
  });

  test("a failed heartbeat write never fails the job", async () => {
    const runMutation = recordMutations(() =>
      Promise.reject(new Error("heartbeat table unavailable"))
    );
    expect(
      await monitored(mockActionCtx({ runMutation }), JOB, async () => null)
    ).toBeNull();
  });
});
