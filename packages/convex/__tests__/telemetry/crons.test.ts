import { describe, expect, mock, test } from "bun:test";
import { type FunctionReference, getFunctionName } from "convex/server";
import { CRONS, cronTasksOn } from "../../cronSchedules";
import crons from "../../crons";
import {
  cleanupExpiredIdempotency,
  cleanupExpiredUploadSessions,
  cleanupSemanticSearchCache,
} from "../../telemetry/crons";
import { handlerOf, mockActionCtx } from "../helpers/convex.test-utils";

const HEARTBEAT = "adminHealth:recordCronRun";

const recordMutations = (
  impl: (
    reference: FunctionReference<"mutation", "internal">,
    args?: unknown
  ) => Promise<unknown> = async () => null
) => mock(impl);

type RecordedMutations = ReturnType<typeof recordMutations>;

const runCron = (
  action: typeof cleanupSemanticSearchCache,
  runMutation: RecordedMutations
) => handlerOf(action)(mockActionCtx({ runMutation }), {});

const jobCalls = (runMutation: RecordedMutations) =>
  runMutation.mock.calls.filter(
    ([reference]) => getFunctionName(reference) !== HEARTBEAT
  );

describe("cron monitoring", () => {
  test.each([["idempotency", cleanupExpiredIdempotency]])(
    "retention cron %s runs only with explicit activation",
    async (kind, action) => {
      const previous = process.env.OPERATIONAL_RETENTION_ENABLED;
      const runMutation = recordMutations();
      try {
        for (const flag of [undefined, "false", "TRUE"]) {
          if (flag === undefined) {
            delete process.env.OPERATIONAL_RETENTION_ENABLED;
          } else {
            process.env.OPERATIONAL_RETENTION_ENABLED = flag;
          }
          expect(await runCron(action, runMutation)).toBeNull();
          expect(jobCalls(runMutation)).toHaveLength(0);
        }
        process.env.OPERATIONAL_RETENTION_ENABLED = "true";
        expect(await runCron(action, runMutation)).toBeNull();
        expect(jobCalls(runMutation)).toHaveLength(1);
        const [reference, args] = jobCalls(runMutation)[0];
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

  test("the hourly cache cleanup removes expired meaning matches and Best match scores", async () => {
    const runMutation = recordMutations();
    expect(
      await handlerOf(cleanupSemanticSearchCache)(
        mockActionCtx({ runMutation }),
        {}
      )
    ).toBeNull();
    expect(
      jobCalls(runMutation).map(([reference]) => getFunctionName(reference))
    ).toEqual([
      "search/semanticCache:cleanupExpired",
      "search/relevanceCache:cleanupExpired",
    ]);
  });

  test("names every scheduled job once", () => {
    const slugs = Object.values(CRONS).map(({ name }) => name);
    expect(slugs).toHaveLength(13);
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
    await runCron(cleanupSemanticSearchCache, runMutation);
    expect(
      runMutation.mock.calls
        .filter(([reference]) => getFunctionName(reference) === HEARTBEAT)
        .map(([, args]) => args)
    ).toEqual([
      { name: "cleanup-semantic-search-cache", phase: "started" },
      { name: "cleanup-semantic-search-cache", phase: "succeeded" },
    ]);
  });

  test("records the error of a failed job and still rethrows it", async () => {
    const heartbeats: unknown[] = [];
    const runMutation = recordMutations((reference, args) => {
      if (getFunctionName(reference) === HEARTBEAT) {
        heartbeats.push(args);
        return Promise.resolve(null);
      }
      return Promise.reject(new Error("cache cleanup failed"));
    });
    await expect(
      runCron(cleanupSemanticSearchCache, runMutation)
    ).rejects.toThrow("cache cleanup failed");
    expect(heartbeats.at(-1)).toEqual({
      name: "cleanup-semantic-search-cache",
      phase: "failed",
      error: "cache cleanup failed",
    });
  });

  test("the hourly upload cleanup only expires upload sessions", async () => {
    const runMutation = recordMutations();
    const runAction = mock(
      (_reference: FunctionReference<"action">, _args?: unknown) =>
        Promise.resolve(null)
    );
    expect(
      await handlerOf(cleanupExpiredUploadSessions)(
        mockActionCtx({ runAction, runMutation }),
        {}
      )
    ).toBeNull();
    expect(
      runAction.mock.calls.map(([reference]) => getFunctionName(reference))
    ).toEqual(["fileUploads:cleanupExpiredMultipartUploads"]);
  });

  test("a failed heartbeat write never fails the job", async () => {
    const runMutation = recordMutations((reference) =>
      getFunctionName(reference) === HEARTBEAT
        ? Promise.reject(new Error("heartbeat table unavailable"))
        : Promise.resolve(null)
    );
    expect(await runCron(cleanupSemanticSearchCache, runMutation)).toBeNull();
  });
});
