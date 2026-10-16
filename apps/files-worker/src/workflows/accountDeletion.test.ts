import { describe, expect, test } from "bun:test";
import { FakeConvexError, type FakeHandler } from "../test/fakeConvex";
import { completionReports, createTestRun } from "../test/fakeRun";
import { withObjectGates } from "../test/testsupport";
import { runAccountDeletion } from "./accountDeletion";
import type { FilesOpCaller } from "./deps";
import { callFilesOp } from "./filesOps";

const ACCOUNT_DATA = 3;
const STATE_ID = "state-1";

interface StorageRow {
  aborts?: Array<{ key: string; uploadId: string }>;
  keys: string[];
}

/**
 * Convex's deletion state and the batches its storage mutations capture,
 * in memory. Each kind holds source rows whose keys drain three at a time.
 */
const deletionBackend = (
  options: {
    stage?: number;
    storage?: Partial<Record<string, StorageRow[]>>;
    workflowIds?: string[];
    writersPrepared?: boolean;
  } = {}
) => {
  const state: Record<string, unknown> & { stage: number } = {
    generation: 1,
    stage: options.stage ?? 0,
    userId: "owner",
    writersPrepared: options.writersPrepared ?? false,
  };
  const storage: Record<string, StorageRow[]> = {
    cards: [],
    exports: [],
    imports: [],
    objects: [],
    uploads: [],
    ...options.storage,
  };
  const events: string[] = [];
  const checkpoints: number[] = [];
  const failures: Record<string, unknown>[] = [];
  let embeddings = [{ cardId: "card-1", rowId: "row-1", shard: 0 }];
  let finalizePages = 1;
  const handlers: Record<string, FakeHandler> = {
    "accountDeletion:beginAccountDataDeletion": () => {
      events.push("begin");
      return null;
    },
    "accountDeletion:removeAccountCardUsage": () => {
      events.push("remove card usage");
      return null;
    },
    "accountDeletionActions:runStage": ({ stage }) => {
      events.push(`stage ${String(stage)}`);
      return true;
    },
    "accountDeletionData:ancillaryPage": () => {
      events.push("ancillary");
      return false;
    },
    "accountDeletionData:cancelJobsPage": ({ table }) => ({
      cursor: "end",
      done: true,
      workflowIds: table === "exportJobs" ? (options.workflowIds ?? []) : [],
    }),
    "accountDeletionData:checkpointStorageBatch": ({ count, kind, offset }) => {
      const row = storage[kind as string]?.[0] as StorageRow;
      const progress = state.storageProgress as { offset: number };
      if (
        progress.offset !== offset ||
        count !== Math.min(3, row.keys.length - (offset as number))
      ) {
        throw new FakeConvexError("deletion_storage_source_changed");
      }
      checkpoints.push(count as number);
      const next = (offset as number) + (count as number);
      if (next < row.keys.length) {
        state.storageProgress = { offset: next };
        return false;
      }
      storage[kind as string]?.shift();
      state.storageProgress = undefined;
      events.push(`drained ${String(kind)}`);
      return true;
    },
    "accountDeletionData:checkpointWriters": ({ table, done }) => {
      if (done && table === "exportJobs") {
        state.writersPrepared = true;
      } else if (done) {
        state.writerTable = "exportJobs";
      }
      events.push(`writers ${String(table)}`);
      return null;
    },
    "accountDeletionData:prepareStorageBatch": ({ kind }) => {
      const row = storage[kind as string]?.[0];
      if (!row) {
        return {
          aborts: [],
          empty: true,
          fingerprint: "",
          keys: [],
          offset: 0,
        };
      }
      const progress = (state.storageProgress as { offset: number }) ?? {
        offset: 0,
      };
      state.storageProgress = progress;
      return {
        aborts: progress.offset === 0 ? (row.aborts ?? []) : [],
        empty: false,
        fingerprint: "fp",
        keys: row.keys.slice(progress.offset, progress.offset + 3),
        offset: progress.offset,
      };
    },
    "accountDeletionJobs:advance": ({ stage }) => {
      state.stage = (stage as number) + 1;
      events.push(`advance ${String(stage)}`);
      return null;
    },
    "accountDeletionJobs:finalize": () => {
      finalizePages -= 1;
      events.push("finalize");
      return finalizePages <= 0;
    },
    "accountDeletionJobs:getState": ({ generation }) => {
      if (generation !== state.generation) {
        throw new FakeConvexError("stale_deletion_generation");
      }
      return { ...state };
    },
    "accountDeletionJobs:recordFailure": (args) => {
      failures.push(args);
      return null;
    },
    "embedding/state:accountEmbeddingsPage": () => embeddings,
    "embedding/state:forgetAccountEmbeddings": () => {
      embeddings = [];
      return null;
    },
  };
  return {
    checkpoints,
    events,
    failures,
    handlers,
    setFinalizePages: (pages: number) => {
      finalizePages = pages;
    },
    state,
    storage,
  };
};

const setup = (
  backend: ReturnType<typeof deletionBackend>,
  options: { env?: Record<string, unknown>; generation?: number } = {}
) => {
  const test = createTestRun(
    { generation: options.generation ?? 1, stateId: STATE_ID },
    {
      env: options.env as never,
      handlers: backend.handlers,
      instanceId: "account-deletion-state-1-1-1",
    }
  );
  const env = withObjectGates(test.env);
  test.run.env = env;
  const opCalls: Array<{ op: string; params: Record<string, unknown> }> = [];
  const ops: FilesOpCaller = (spec) => {
    opCalls.push({ op: spec.op, params: spec.params });
    if (spec.op === "vector-delete") {
      return Promise.resolve({ data: {} as never, kind: "ok" });
    }
    return callFilesOp(env, spec);
  };
  return { ...test, opCalls, ops };
};

const keys = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `users/owner/cards/c1/artifact-${String(index)}`
  );

describe("runAccountDeletion", () => {
  test("resumes from the stage its state records and finalizes", async () => {
    const backend = deletionBackend({ stage: 4 });
    const test = setup(backend);

    await runAccountDeletion(test.run, { convex: test.convex, ops: test.ops });

    expect(backend.events).toEqual([
      "stage 4",
      "advance 4",
      "stage 5",
      "advance 5",
      "finalize",
    ]);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("drains storage three fenced keys at a time before its rows go", async () => {
    const backend = deletionBackend({
      stage: ACCOUNT_DATA,
      storage: { cards: [{ keys: keys(7) }] },
      writersPrepared: true,
    });
    const test = setup(backend);
    for (const key of keys(7)) {
      test.bucket.objects.set(key, { bytes: new Uint8Array([1]) });
    }
    const upload = test.bucket.createMultipartUpload("users/owner/upload.bin");
    backend.storage.uploads = [
      {
        aborts: [{ key: upload.key, uploadId: upload.uploadId }],
        keys: [upload.key],
      },
    ];

    await runAccountDeletion(test.run, { convex: test.convex, ops: test.ops });

    expect(test.bucket.deleteBatches).toEqual([
      keys(7).slice(0, 3),
      keys(7).slice(3, 6),
      keys(7).slice(6),
      [upload.key],
    ]);
    expect(test.bucket.objects.size).toBe(0);
    expect(test.bucket.multipartUploads.size).toBe(0);
    expect(backend.checkpoints).toEqual([3, 3, 1, 1]);
    // Every key is frozen against writers before its batch is deleted.
    const firstDelete = test.opCalls.findIndex(
      (call) => call.op === "delete-objects"
    );
    expect(
      test.opCalls
        .slice(0, firstDelete)
        .filter((call) => call.op === "freeze-object")
        .map((call) => call.params.key)
    ).toEqual(keys(7).slice(0, 3));
    expect(
      test.opCalls.find((call) => call.op === "vector-delete")?.params
    ).toEqual({ ids: ["card-1"], shard: 0 });
    expect(backend.events).toEqual([
      "begin",
      "drained cards",
      "remove card usage",
      "drained uploads",
      "ancillary",
      "advance 3",
      "stage 4",
      "advance 4",
      "stage 5",
      "advance 5",
      "finalize",
    ]);
  });

  test("an object still being written keeps its rows, records why and fails the run", async () => {
    const backend = deletionBackend({
      stage: ACCOUNT_DATA,
      storage: { cards: [{ keys: keys(2) }] },
      writersPrepared: true,
    });
    const test = setup(backend);
    const ops: FilesOpCaller = (spec) =>
      spec.op === "freeze-object"
        ? Promise.resolve({ data: { frozen: false } as never, kind: "ok" })
        : test.ops(spec);

    await expect(
      runAccountDeletion(test.run, { convex: test.convex, ops })
    ).rejects.toThrow("deletion_object_write_pending");

    expect(backend.failures).toEqual([
      {
        generation: 1,
        reason: "object_write_pending",
        stage: ACCOUNT_DATA,
        stateId: STATE_ID,
      },
    ]);
    expect(backend.checkpoints).toEqual([]);
    expect(test.bucket.deleteBatches).toEqual([]);
    expect(backend.state.stage).toBe(ACCOUNT_DATA);
    expect(completionReports(test.callsTo)).toEqual(["errored"]);
  });

  test("a failing stage retries with a capped backoff, then records the failure", async () => {
    const backend = deletionBackend();
    backend.handlers["accountDeletionActions:runStage"] = () => {
      throw new Error("deletion_posthog_unavailable");
    };
    const test = setup(backend);

    await expect(
      runAccountDeletion(test.run, { convex: test.convex, ops: test.ops })
    ).rejects.toThrow("deletion_posthog_unavailable");

    expect(
      test.steps.delays
        .filter((delay) => delay.name === "stage 0 1")
        .map((delay) => delay.delay)
    ).toEqual([
      10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
      300_000, 300_000,
    ]);
    expect(backend.failures).toEqual([
      {
        generation: 1,
        reason: "analytics_deletion_failed",
        stage: 0,
        stateId: STATE_ID,
      },
    ]);
    expect(backend.state.stage).toBe(0);
  });

  test("waits while the account's export is still running", async () => {
    const backend = deletionBackend({
      stage: ACCOUNT_DATA,
      workflowIds: ["export-job-1"],
    });
    let polls = 0;
    const exports = {
      get: () =>
        Promise.resolve({
          status: () => {
            polls += 1;
            return Promise.resolve({
              status: polls < 3 ? "running" : "complete",
            });
          },
        }),
    };
    const test = setup(backend, { env: { EXPORTS: exports } });

    await runAccountDeletion(test.run, { convex: test.convex, ops: test.ops });

    expect(
      test.steps.records.find((record) => record.name === "prepare writers 2")
    ).toMatchObject({ attempts: 3, outcome: "ok" });
    expect(backend.state.writersPrepared).toBe(true);
    expect(backend.events.slice(0, 3)).toEqual([
      "writers importJobs",
      "writers exportJobs",
      "begin",
    ]);
  });

  test("a stale generation ends the run without retrying", async () => {
    const backend = deletionBackend({ stage: 4 });
    const test = setup(backend, { generation: 2 });

    await expect(
      runAccountDeletion(test.run, { convex: test.convex, ops: test.ops })
    ).rejects.toThrow("stale_deletion_generation");

    expect(test.steps.records[0]).toMatchObject({
      attempts: 1,
      name: "load state 0",
      outcome: "error",
    });
    expect(backend.events).toEqual([]);
  });

  test("finalization settles receipts page by page until the state is gone", async () => {
    const backend = deletionBackend({ stage: 6 });
    backend.setFinalizePages(3);
    const test = setup(backend);

    await runAccountDeletion(test.run, { convex: test.convex, ops: test.ops });

    expect(backend.events).toEqual(["finalize", "finalize", "finalize"]);
  });
});
