import type { DispatchItem } from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildR2UserPrefix } from "./storage/r2";
import {
  queueCardOutcome,
  queueCardProcessingFailed,
  queueUserCreated,
} from "./telemetry/schedule";
import {
  DEAD_LETTER_RETRY_MS,
  DISPATCH_RETENTION_MS,
  enqueueObjectDeletion,
  MAX_DISPATCH_ATTEMPTS,
  queueAccountDeletionWorkflow,
  queueExportWorkflow,
  queueImportWorkflow,
  signDispatch,
} from "./workflowDispatch";

const modules = import.meta.glob("./**/*.ts");
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-16T10:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const fileKey = (index: number) => `users/u1/cards/c1/file/${index}.png`;

const rows = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("workflowDispatches").collect());

const scheduledJobs = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

const reportedFailures = async (t: ReturnType<typeof convexTest>) =>
  (await scheduledJobs(t))
    .filter((job) => job.name === "telemetry/alerts:reportBackgroundFailure")
    .map((job) => job.args[0] as { message: string });

const capturePostHog = () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  const batches: Array<Array<{ event: string; properties: unknown }>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (String(url).endsWith("/batch/")) {
        batches.push(JSON.parse(String(init.body)).batch);
      }
      return Promise.resolve(Response.json({ status: 1 }));
    })
  );
  return () => batches.flat();
};

const sentAtMaxAttempts = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const [row] = await ctx.db.query("workflowDispatches").collect();
    await ctx.db.patch("workflowDispatches", row!._id, {
      attempts: MAX_DISPATCH_ATTEMPTS,
      sentAt: NOW,
      state: "sent",
    });
    return row!._id;
  });

const insertExportJob = (t: ReturnType<typeof convexTest>, status: string) =>
  t.run((ctx) =>
    ctx.db.insert("exportJobs", {
      createdAt: NOW,
      status: status as "running",
      updatedAt: NOW,
      userId: "user-1",
    })
  );

const insertImportJob = (t: ReturnType<typeof convexTest>, status: string) =>
  t.run((ctx) =>
    ctx.db.insert("importJobs", {
      createdAt: NOW,
      createdCount: 0,
      failedCount: 0,
      fileLastModified: NOW,
      fileName: "export.zip",
      fileSize: 10,
      mode: "archive",
      parsedCount: 0,
      phase: "Importing cards",
      processedCount: 0,
      skippedCount: 0,
      sourceKey: "users/u1/cards/pending/import-source/a.zip",
      status: status as "importing",
      updatedAt: NOW,
      userId: "user-1",
    })
  );

describe("enqueueObjectDeletion", () => {
  test("queues namespaced keys in batches the Worker accepts", async () => {
    const t = convexTest(schema, modules);
    const keys = [
      ...Array.from({ length: 250 }, (_, index) => fileKey(index)),
      fileKey(0),
      "",
      "not-a-teak-key",
    ];
    const queued = await t.run((ctx) => enqueueObjectDeletion(ctx, keys));
    expect(queued).toBe(250);
    const queuedRows = await rows(t);
    expect(queuedRows.map((row) => row.keys?.length)).toEqual([100, 100, 50]);
    expect(queuedRows.every((row) => row.state === "pending")).toBe(true);
  });
});

describe("claim", () => {
  test("hands over due rows as dispatch items and marks them sent", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run(async (ctx) => {
      await queueExportWorkflow(ctx, jobId, "user-1");
      await enqueueObjectDeletion(ctx, [fileKey(1)]);
    });
    const claimed = await t.mutation(internal.workflowDispatch.claim, {});
    const items = claimed.map(
      ({ item }: { item: unknown }) => item as DispatchItem
    );
    expect(items).toContainEqual({
      id: `export-${jobId}`,
      params: { jobId, userId: "user-1" },
      type: "workflow",
      workflow: "export",
    });
    expect(items).toContainEqual({
      keys: [fileKey(1)],
      type: "delete-objects",
    });
    expect((await rows(t)).every((row) => row.state === "sent")).toBe(true);
    expect(await t.mutation(internal.workflowDispatch.claim, {})).toEqual([]);
  });

  test("leaves rows that are not due yet", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("workflowDispatches", {
        createdAt: NOW,
        key: "deleteObjects",
        keys: [fileKey(1)],
        kind: "deleteObjects",
        notBefore: NOW + 60_000,
        state: "pending",
      })
    );
    expect(await t.mutation(internal.workflowDispatch.claim, {})).toEqual([]);
  });
});

describe("release", () => {
  test("puts rows the Worker refused back to pending with a delay", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(1)]));
    const [claimed] = await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.release, {
      error: "queue_failed",
      ids: [claimed?.id as Id<"workflowDispatches">],
    });
    const [row] = await rows(t);
    expect(row?.state).toBe("pending");
    expect(row?.error).toBe("queue_failed");
    expect(row?.notBefore).toBeGreaterThan(NOW);
  });

  test("gives up after the last attempt and fails the job it owned", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    const dispatchId = await t.run(async (ctx) => {
      await queueExportWorkflow(ctx, jobId, "user-1");
      const [row] = await ctx.db.query("workflowDispatches").collect();
      await ctx.db.patch("workflowDispatches", row!._id, {
        attempts: MAX_DISPATCH_ATTEMPTS,
        state: "sent",
      });
      return row!._id;
    });
    await t.mutation(internal.workflowDispatch.release, {
      error: "workflow_missing",
      ids: [dispatchId],
    });
    const [row] = await rows(t);
    expect(row?.state).toBe("failed");
    const job = await t.run((ctx) => ctx.db.get("exportJobs", jobId));
    expect(job?.status).toBe("failed");
  });

  test("reports a row it gives up on", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run((ctx) => queueExportWorkflow(ctx, jobId, "user-1"));
    const dispatchId = await sentAtMaxAttempts(t);
    await t.mutation(internal.workflowDispatch.release, {
      error: "worker_down",
      ids: [dispatchId],
    });
    expect(await reportedFailures(t)).toEqual([
      expect.objectContaining({ message: "workflow_dispatch_dead_lettered" }),
    ]);
  });

  test("queues the keys of a deletion it gives up on again after a long wait", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(1), fileKey(2)]));
    const dispatchId = await sentAtMaxAttempts(t);
    await t.mutation(internal.workflowDispatch.release, {
      error: "worker_down",
      ids: [dispatchId],
    });
    const all = await rows(t);
    expect(
      all.filter((row) => row.state === "failed").map((row) => row._id)
    ).toEqual([dispatchId]);
    const pending = all.filter((row) => row.state === "pending");
    expect(pending).toMatchObject([
      {
        keys: [fileKey(1), fileKey(2)],
        kind: "deleteObjects",
        notBefore: NOW + DEAD_LETTER_RETRY_MS,
      },
    ]);
    expect(pending[0]?.attempts).toBeUndefined();
  });
});

describe("complete", () => {
  const sendAll = async (t: ReturnType<typeof convexTest>) => {
    await t.mutation(internal.workflowDispatch.claim, {});
  };

  test("marks a run done when it reports success", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertImportJob(t, "importing");
    await t.run((ctx) => queueImportWorkflow(ctx, jobId));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: `import-${jobId}`,
      status: "complete",
    });
    const [row] = await rows(t);
    expect(row?.state).toBe("done");
    const job = await t.run((ctx) => ctx.db.get("importJobs", jobId));
    expect(job?.status).toBe("importing");
  });

  test("fails an export that is still running when its run errors", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "running");
    await t.run((ctx) => queueExportWorkflow(ctx, jobId, "user-1"));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      error: "boom",
      instanceId: `export-${jobId}`,
      status: "errored",
    });
    const job = await t.run((ctx) => ctx.db.get("exportJobs", jobId));
    expect(job?.status).toBe("failed");
    expect(job?.failureClass).toBe("unknown");
    const [row] = await rows(t);
    expect(row?.state).toBe("failed");
  });

  test("leaves an export that already finished alone", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "ready");
    await t.run((ctx) => queueExportWorkflow(ctx, jobId, "user-1"));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: `export-${jobId}`,
      status: "errored",
    });
    const job = await t.run((ctx) => ctx.db.get("exportJobs", jobId));
    expect(job?.status).toBe("ready");
  });

  test("fails an import that is still active when its run errors", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertImportJob(t, "importing");
    await t.run((ctx) => queueImportWorkflow(ctx, jobId));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: `import-${jobId}`,
      status: "errored",
    });
    const job = await t.run((ctx) => ctx.db.get("importJobs", jobId));
    expect(job?.status).toBe("failed");
    expect(job?.failureClass).toBe("import_workflow_failed");
  });

  test("deletes the items an import staged in R2 when its run errors", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertImportJob(t, "importing");
    await t.run((ctx) =>
      ctx.db.patch("importJobs", jobId, {
        stagedItems: { pages: 3, parts: 2, cursor: null, part: 1, offset: 4 },
      })
    );
    await t.run((ctx) => queueImportWorkflow(ctx, jobId));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: `import-${jobId}`,
      status: "errored",
    });
    const prefix = buildR2UserPrefix("user-1");
    expect(
      (await rows(t)).filter((row) => row.kind === "deleteObjects")
    ).toMatchObject([
      {
        keys: [
          `${prefix}/imports/${jobId}/staged/1.json`,
          `${prefix}/imports/${jobId}/staged/2.json`,
        ],
      },
    ]);
  });

  test("starts the next account deletion attempt when a run errors", async () => {
    const t = convexTest(schema, modules);
    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: 3,
        startedAt: NOW,
        userId: "user-1",
      })
    );
    await t.run((ctx) =>
      queueAccountDeletionWorkflow(ctx, { generation: 1, stateId })
    );
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: `account-deletion-${stateId}-1-${NOW}`,
      status: "errored",
    });
    const next = (await rows(t)).find((row) => row.state === "pending");
    expect(next?.instanceId).toBe(`account-deletion-${stateId}-1-${NOW + 1}`);
    expect(next?.notBefore).toBe(NOW + 5 * 60 * 1000);
  });

  const insertDeletionState = (
    t: ReturnType<typeof convexTest>,
    fields: { failureCode?: string } = {}
  ) =>
    t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: 3,
        startedAt: NOW,
        userId: "user-1",
        ...fields,
      })
    );

  const failNextDeletionRun = async (t: ReturnType<typeof convexTest>) => {
    const next = (await rows(t)).find((row) => row.state === "pending");
    vi.setSystemTime(next!.notBefore);
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: next!.instanceId!,
      status: "errored",
    });
  };

  test("waits longer after each failed account deletion attempt, up to a cap", async () => {
    const t = convexTest(schema, modules);
    const stateId = await insertDeletionState(t);
    await t.run((ctx) =>
      queueAccountDeletionWorkflow(ctx, { generation: 1, stateId })
    );
    const waits: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await failNextDeletionRun(t);
      const next = (await rows(t)).find((row) => row.state === "pending");
      waits.push(next!.notBefore - Date.now());
      const state = await t.run((ctx) =>
        ctx.db.get("accountDeletionStates", stateId)
      );
      expect(state?.nextAttemptAt).toBe(next!.notBefore);
    }
    const MINUTE = 60_000;
    expect(waits).toEqual([
      5 * MINUTE,
      10 * MINUTE,
      20 * MINUTE,
      40 * MINUTE,
      80 * MINUTE,
      160 * MINUTE,
      320 * MINUTE,
      6 * HOUR_MS,
    ]);
  });

  test("stops and reports an account deletion only an operator can unblock", async () => {
    const t = convexTest(schema, modules);
    const stateId = await insertDeletionState(t, {
      failureCode: "account_deletion_stage_3_storage_source_changed",
    });
    await t.run((ctx) =>
      queueAccountDeletionWorkflow(ctx, { generation: 1, stateId })
    );
    await failNextDeletionRun(t);
    expect((await rows(t)).map((row) => row.state)).toEqual(["failed"]);
    expect(await reportedFailures(t)).toEqual([
      expect.objectContaining({ message: "account_deletion_needs_operator" }),
    ]);
  });

  test("an operator's retry starts the stopped account deletion again", async () => {
    const t = convexTest(schema, modules);
    const stateId = await insertDeletionState(t, {
      failureCode: "account_deletion_stage_3_storage_source_changed",
    });
    await t.mutation(internal.accountDeletionJobs.retry, { stateId });
    const state = await t.run((ctx) =>
      ctx.db.get("accountDeletionStates", stateId)
    );
    expect(state?.failureCode).toBeUndefined();
    expect(
      (await rows(t)).filter((row) => row.state === "pending")
    ).toMatchObject([{ key: `accountDeletion:${stateId}:1`, notBefore: NOW }]);
  });

  test("sends a run again when its hand-over was lost", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run((ctx) => queueExportWorkflow(ctx, jobId, "user-1"));
    await sendAll(t);
    await t.mutation(internal.workflowDispatch.complete, {
      error: "instance_missing",
      instanceId: `export-${jobId}`,
      status: "errored",
    });
    expect((await rows(t)).map((row) => row.state)).toEqual(["pending"]);
    const job = await t.run((ctx) => ctx.db.get("exportJobs", jobId));
    expect(job?.status).toBe("pending");
  });

  test("ignores a run Convex never dispatched", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: "card-cleanup-2026-10-16-abc",
      status: "complete",
    });
    expect(await rows(t)).toEqual([]);
  });
});

describe("reconcile helpers", () => {
  test("lists only runs silent for longer than their kind allows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [kind, instanceId, sentAgo] of [
        ["export", "export-old", 3 * HOUR_MS],
        ["export", "export-recent", HOUR_MS + 60_000],
        ["import", "import-recent", 3 * HOUR_MS],
      ] as const) {
        await ctx.db.insert("workflowDispatches", {
          createdAt: NOW - sentAgo,
          instanceId,
          key: instanceId,
          kind,
          notBefore: NOW - sentAgo,
          sentAt: NOW - sentAgo,
          state: "sent",
        });
      }
    });
    expect(await t.query(internal.workflowDispatch.listStale, {})).toEqual([
      { instanceId: "export-old", kind: "export", workflow: "export" },
    ]);
  });

  const insertSent = (
    t: ReturnType<typeof convexTest>,
    rowsToInsert: ReadonlyArray<readonly ["export" | "import", string, number]>
  ) =>
    t.run(async (ctx) => {
      for (const [kind, instanceId, sentAgo] of rowsToInsert) {
        await ctx.db.insert("workflowDispatches", {
          createdAt: NOW - sentAgo,
          instanceId,
          key: instanceId,
          kind,
          notBefore: NOW - sentAgo,
          sentAt: NOW - sentAgo,
          state: "sent",
        });
      }
    });

  const staleIds = async (t: ReturnType<typeof convexTest>, limit: number) =>
    (await t.query(internal.workflowDispatch.listStale, { limit })).map(
      (row: { instanceId: string }) => row.instanceId
    );

  test("runs too young for their kind do not crowd out stale ones", async () => {
    const t = convexTest(schema, modules);
    await insertSent(t, [
      ["import", "import-1", 5 * HOUR_MS],
      ["import", "import-2", 5 * HOUR_MS],
      ["export", "export-old", 3 * HOUR_MS],
    ]);
    expect(await staleIds(t, 2)).toEqual(["export-old"]);
  });

  test("runs the reconcile found still running wait behind unchecked ones", async () => {
    const t = convexTest(schema, modules);
    await insertSent(t, [
      ["export", "export-a", 5 * HOUR_MS],
      ["export", "export-b", 4 * HOUR_MS],
      ["export", "export-c", 3 * HOUR_MS],
    ]);
    expect(await staleIds(t, 2)).toEqual(["export-a", "export-b"]);
    await t.mutation(internal.workflowDispatch.markReconciled, {
      instanceIds: ["export-a", "export-b"],
    });
    expect(await staleIds(t, 2)).toEqual(["export-c", "export-a"]);
    vi.setSystemTime(NOW + 60_000);
    await t.mutation(internal.workflowDispatch.markReconciled, {
      instanceIds: ["export-c", "export-a"],
    });
    expect(await staleIds(t, 3)).toEqual(["export-b", "export-a", "export-c"]);
  });

  test("a run sent again is unchecked again", async () => {
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run((ctx) => queueExportWorkflow(ctx, jobId, "user-1"));
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.markReconciled, {
      instanceIds: [`export-${jobId}`],
    });
    expect((await rows(t))[0]?.lastReconciledAt).toBe(NOW);
    await t.mutation(internal.workflowDispatch.complete, {
      error: "instance_missing",
      instanceId: `export-${jobId}`,
      status: "errored",
    });
    await t.mutation(internal.workflowDispatch.claim, {});
    const [row] = await rows(t);
    expect(row?.state).toBe("sent");
    expect(row?.lastReconciledAt).toBeUndefined();
  });

  test("deletes finished rows past retention and settles old deletions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("workflowDispatches", {
        createdAt: NOW - DISPATCH_RETENTION_MS - HOUR_MS,
        finishedAt: NOW - DISPATCH_RETENTION_MS - 1,
        key: "deleteObjects",
        kind: "deleteObjects",
        notBefore: 0,
        state: "done",
      });
      await ctx.db.insert("workflowDispatches", {
        createdAt: NOW - HOUR_MS,
        finishedAt: NOW - HOUR_MS,
        key: "deleteObjects",
        kind: "deleteObjects",
        notBefore: 0,
        state: "done",
      });
      await ctx.db.insert("workflowDispatches", {
        createdAt: NOW - 2 * HOUR_MS,
        key: "deleteObjects",
        kind: "deleteObjects",
        notBefore: 0,
        sentAt: NOW - 2 * HOUR_MS,
        state: "sent",
      });
    });
    const result = await t.mutation(
      internal.workflowDispatch.pruneFinished,
      {}
    );
    expect(result).toEqual({ deleted: 1, hasMore: false, stuckPending: 0 });
    expect((await rows(t)).map((row) => row.state)).toEqual(["done", "done"]);
  });
});

describe("flush", () => {
  test("leaves rows pending when no Files Worker is configured", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(1)]));
    await t.action(internal.workflowDispatch.flush, {});
    expect((await rows(t)).map((row) => row.state)).toEqual(["pending"]);
  });

  test("reports rows it cannot send while no Files Worker is configured", async () => {
    const sentEvents = capturePostHog();
    const t = convexTest(schema, modules);
    await t.action(internal.workflowDispatch.flush, {});
    expect(sentEvents()).toEqual([]);
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(1)]));
    await t.action(internal.workflowDispatch.flush, {});
    expect(sentEvents()).toMatchObject([
      {
        event: "$exception",
        properties: {
          $exception_list: [{ value: "workflow_dispatch_not_configured" }],
        },
      },
    ]);
  });

  test("sends due rows and retries the items the Worker refused", async () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "flush-secret");
    vi.stubEnv("WORKFLOW_RPC_SECRET", "deployment-rpc-secret");
    const sent: Array<{
      convexSiteUrl: string;
      expiresAt: string;
      items: DispatchItem[];
      signature: string;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          params: {
            convexSiteUrl: string;
            expiresAt: string;
            items: DispatchItem[];
            signature: string;
          };
        };
        sent.push(body.params);
        return Promise.resolve(
          Response.json({
            data: {
              results: body.params.items.map((item, index) => ({
                index,
                ok: item.type === "delete-objects",
                ...(item.type === "delete-objects"
                  ? {}
                  : { error: "workflow_missing" }),
              })),
            },
            ok: true,
            requestId: "r",
            version: 1,
          })
        );
      })
    );
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run(async (ctx) => {
      await enqueueObjectDeletion(ctx, [fileKey(1)]);
      await queueExportWorkflow(ctx, jobId, "user-1");
    });
    await t.action(internal.workflowDispatch.flush, {});
    expect(sent).toHaveLength(1);
    const params = sent[0];
    expect(params?.convexSiteUrl).toBe("https://session-tests.convex.site");
    expect(params?.signature).toBe(
      (
        await signDispatch(
          "deployment-rpc-secret",
          "https://session-tests.convex.site",
          params?.items ?? [],
          (Number(params?.expiresAt) - 120) * 1000
        )
      ).signature
    );
    const states = Object.fromEntries(
      (await rows(t)).map((row) => [row.kind, row.state])
    );
    expect(states).toEqual({ deleteObjects: "done", export: "pending" });
  });
});

describe("flush scheduling", () => {
  const flushes = async (t: ReturnType<typeof convexTest>) =>
    (await scheduledJobs(t)).filter(
      (job) => job.name === "workflowDispatch:flush"
    ).length;

  test("saves made before the flush runs share one flush", async () => {
    const t = convexTest(schema, modules);
    const first = await insertExportJob(t, "pending");
    const second = await insertExportJob(t, "pending");
    await t.run((ctx) => queueExportWorkflow(ctx, first, "user-1"));
    await t.run((ctx) => queueExportWorkflow(ctx, second, "user-1"));
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(1)]));
    expect(await flushes(t)).toBe(1);
  });

  test("a save after the last flush claimed everything gets its own flush", async () => {
    const t = convexTest(schema, modules);
    const first = await insertExportJob(t, "pending");
    const second = await insertExportJob(t, "pending");
    await t.run((ctx) => queueExportWorkflow(ctx, first, "user-1"));
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.run((ctx) => queueExportWorkflow(ctx, second, "user-1"));
    expect(await flushes(t)).toBe(2);
  });

  test("a row left waiting does not hold back the next save", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("workflowDispatches", {
        createdAt: NOW - HOUR_MS,
        key: "deleteObjects",
        keys: [fileKey(1)],
        kind: "deleteObjects",
        notBefore: NOW - 10 * 60_000,
        state: "pending",
      })
    );
    await t.run((ctx) => enqueueObjectDeletion(ctx, [fileKey(2)]));
    expect(await flushes(t)).toBe(1);
  });

  test("a flush also sends rows queued while it was handing over", async () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "flush-secret");
    vi.stubEnv("WORKFLOW_RPC_SECRET", "deployment-rpc-secret");
    const t = convexTest(schema, modules);
    const first = await insertExportJob(t, "pending");
    const second = await insertExportJob(t, "pending");
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          await t.run((ctx) => queueExportWorkflow(ctx, second, "user-1"));
        }
        const { params } = JSON.parse(String(init.body)) as {
          params: { items: DispatchItem[] };
        };
        return Response.json({
          data: {
            results: params.items.map((_item, index) => ({ index, ok: true })),
          },
          ok: true,
          requestId: "r",
          version: 1,
        });
      })
    );
    await t.run((ctx) => queueExportWorkflow(ctx, first, "user-1"));
    await t.action(internal.workflowDispatch.flush, {});
    expect((await rows(t)).map((row) => row.state)).toEqual(["sent", "sent"]);
  });
});

describe("analytics events", () => {
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  const signUp = {
    email: "a@example.com",
    source: "auth",
    userId: "teak_u1",
  };

  const workerConfigured = () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "flush-secret");
  };

  const scheduledNames = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).map(
        (job) => job.name
      )
    );

  test("queues nothing while PostHog capture is off", async () => {
    workerConfigured();
    const t = convexTest(schema, modules);
    await t.run((ctx) => queueUserCreated(ctx, signUp));
    expect(await rows(t)).toEqual([]);
    expect(await scheduledNames(t)).toEqual([]);
  });

  test("rides the flush the same change already scheduled", async () => {
    workerConfigured();
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run(async (ctx) => {
      await queueExportWorkflow(ctx, jobId, "user-1");
      await queueCardOutcome(ctx, {
        cardType: "text",
        outcome: "success",
        source: "web",
        userId: "teak_u1",
      });
      await queueUserCreated(ctx, signUp);
    });
    expect((await rows(t)).map((row) => row.kind)).toEqual([
      "export",
      "analyticsEvent",
      "analyticsEvent",
    ]);
    expect(await scheduledNames(t)).toEqual(["workflowDispatch:flush"]);
  });

  test("claim hands events over as Convex captures them and removes their rows", async () => {
    workerConfigured();
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("CONVEX_GIT_COMMIT_SHA", "abc123def4567890");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await queueUserCreated(ctx, signUp);
      await queueCardProcessingFailed(ctx, {
        errorClass: "timeout",
        stage: "renderables",
      });
    });
    const claimed = await t.mutation(internal.workflowDispatch.claim, {});
    const now = new Date(NOW).toISOString();
    expect(claimed.map(({ item }: { item: unknown }) => item)).toEqual([
      {
        appVersion: "abc123def456",
        distinctId: "teak_u1",
        event: "user_signed_up",
        properties: { source: "auth", surface: "backend" },
        set: { email: "a@example.com", plan: "free", signed_up_at: now },
        timestamp: now,
        type: "analytics-event",
        uuid: expect.stringMatching(UUID),
      },
      {
        appVersion: "abc123def456",
        event: "card_processing_failed",
        properties: {
          error_class: "timeout",
          stage: "renderables",
          surface: "backend",
        },
        timestamp: now,
        type: "analytics-event",
        uuid: expect.stringMatching(UUID),
      },
    ]);
    expect(await rows(t)).toEqual([]);
  });

  test("a failed hand-over drops events but retries the rest", async () => {
    workerConfigured();
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("WORKFLOW_RPC_SECRET", "deployment-rpc-secret");
    const sent: DispatchItem[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        sent.push(
          (
            JSON.parse(String(init.body)) as {
              params: { items: DispatchItem[] };
            }
          ).params.items
        );
        return Promise.reject(new Error("worker_down"));
      })
    );
    const t = convexTest(schema, modules);
    const jobId = await insertExportJob(t, "pending");
    await t.run(async (ctx) => {
      await queueExportWorkflow(ctx, jobId, "user-1");
      await queueUserCreated(ctx, signUp);
    });
    await t.action(internal.workflowDispatch.flush, {});
    expect(sent.flat().map((item) => item.type)).toEqual([
      "workflow",
      "analytics-event",
    ]);
    expect((await rows(t)).map((row) => [row.kind, row.state])).toEqual([
      ["export", "pending"],
    ]);
  });
});
