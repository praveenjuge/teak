import { describe, expect, test } from "bun:test";
import { createConvexRpc } from "../convexRpc";
import {
  createFakeConvex,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "../test/fakeConvex";
import { reconcileWorkflows } from "./workflowReconcile";

type Status = InstanceStatus["status"];

const fakeWorkflow = (
  instances: Record<
    string,
    Status | { error: string; status: Status } | "lookup-fails"
  >
) =>
  ({
    get: (id: string) => {
      const entry = instances[id];
      if (entry === undefined) {
        return Promise.reject(new Error("instance.not_found"));
      }
      if (entry === "lookup-fails") {
        return Promise.reject(new Error("internal error"));
      }
      const status =
        typeof entry === "string"
          ? { status: entry }
          : {
              error: { message: entry.error, name: "Error" },
              status: entry.status,
            };
      return Promise.resolve({ status: () => Promise.resolve(status) });
    },
  }) as unknown as Workflow;

const run = async (
  stale: Array<{ instanceId: string; workflow: string }>,
  bindings: Record<string, Workflow>,
  prunePages: Array<{ deleted: number; hasMore: boolean }> = [
    { deleted: 0, hasMore: false },
  ]
) => {
  const convex = createFakeConvex({
    "workflowDispatch:complete": () => null,
    "workflowDispatch:listStale": () =>
      stale.map((row) => ({ ...row, kind: "export" })),
    "workflowDispatch:markReconciled": () => null,
    "workflowDispatch:pruneFinished": () => ({
      stuckPending: 0,
      ...(prunePages.shift() ?? { deleted: 0, hasMore: false }),
    }),
  });
  const summary = await reconcileWorkflows(
    { ...fakeConvexEnv, ...bindings },
    createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, convex.fetcher)
  );
  return {
    completions: convex
      .callsTo("workflowDispatch:complete")
      .map((call) => call.args),
    convex,
    summary,
  };
};

describe("workflow reconcile", () => {
  test("reports how quiet runs ended and leaves running ones alone", async () => {
    const { completions, summary } = await run(
      [
        { instanceId: "export-done", workflow: "export" },
        { instanceId: "export-failed", workflow: "export" },
        { instanceId: "export-stopped", workflow: "export" },
        { instanceId: "export-gone", workflow: "export" },
        { instanceId: "export-busy", workflow: "export" },
        { instanceId: "export-waiting", workflow: "export" },
        { instanceId: "card-1-2", workflow: "card-processing" },
      ],
      {
        CARD_PROCESSING: fakeWorkflow({ "card-1-2": "queued" }),
        EXPORTS: fakeWorkflow({
          "export-busy": "running",
          "export-done": "complete",
          "export-failed": { error: "zip failed", status: "errored" },
          "export-stopped": "terminated",
          "export-waiting": "waiting",
        }),
      }
    );
    expect(completions).toEqual([
      { instanceId: "export-done", status: "complete" },
      { error: "zip failed", instanceId: "export-failed", status: "errored" },
      { error: "terminated", instanceId: "export-stopped", status: "errored" },
      {
        error: "instance_missing",
        instanceId: "export-gone",
        status: "errored",
      },
    ]);
    expect(summary).toMatchObject({
      checked: 7,
      completed: 1,
      errored: 3,
      running: 3,
    });
  });

  test("tries a failed lookup again next hour instead of guessing", async () => {
    const { completions } = await run(
      [{ instanceId: "import-1", workflow: "import" }],
      { IMPORTS: fakeWorkflow({ "import-1": "lookup-fails" }) }
    );
    expect(completions).toEqual([]);
  });

  test("records the runs it found still going so newer ones get checked next", async () => {
    const { convex } = await run(
      [
        { instanceId: "export-busy", workflow: "export" },
        { instanceId: "export-done", workflow: "export" },
        { instanceId: "import-1", workflow: "import" },
      ],
      {
        EXPORTS: fakeWorkflow({
          "export-busy": "running",
          "export-done": "complete",
        }),
        IMPORTS: fakeWorkflow({ "import-1": "lookup-fails" }),
      }
    );
    expect(
      convex.callsTo("workflowDispatch:markReconciled").map((call) => call.args)
    ).toEqual([{ instanceIds: ["export-busy", "import-1"] }]);
  });

  test("still finishes against a Convex deployment that can't record checks", async () => {
    const convex = createFakeConvex({
      "workflowDispatch:complete": () => null,
      "workflowDispatch:listStale": () => [
        { instanceId: "export-busy", kind: "export", workflow: "export" },
      ],
      "workflowDispatch:pruneFinished": () => ({
        deleted: 3,
        hasMore: false,
        stuckPending: 0,
      }),
    });
    const olderConvex = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) =>
      String(init?.body).includes("workflowDispatch:markReconciled")
        ? Response.json({ error: "function_not_allowed" }, { status: 403 })
        : await convex.fetcher(input, init)) as typeof fetch;
    const summary = await reconcileWorkflows(
      {
        ...fakeConvexEnv,
        EXPORTS: fakeWorkflow({ "export-busy": "running" }),
      },
      createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, olderConvex)
    );
    expect(summary).toMatchObject({ checked: 1, pruned: 3, running: 1 });
  });

  test("prunes finished rows page by page", async () => {
    const { convex, summary } = await run([], {}, [
      { deleted: 200, hasMore: true },
      { deleted: 50, hasMore: false },
    ]);
    expect(convex.callsTo("workflowDispatch:pruneFinished")).toHaveLength(2);
    expect(summary.pruned).toBe(250);
  });
});
