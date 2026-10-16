/// <reference types="vite/client" />
import type { DispatchItem } from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
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
  vi.useFakeTimers({ toFake: ["Date"] });
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
    // Attempts are numbered by when they were queued, so an ID is never
    // reused even after older rows are pruned.
    expect(next?.instanceId).toBe(`account-deletion-${stateId}-1-${NOW + 1}`);
    expect(next?.notBefore).toBe(NOW + 5 * 60 * 1000);
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
    // The proof is signed with this deployment's own RPC secret.
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
    // Accepted deletions are the queue's now; refused runs wait to be sent again.
    expect(states).toEqual({ deleteObjects: "done", export: "pending" });
  });
});
