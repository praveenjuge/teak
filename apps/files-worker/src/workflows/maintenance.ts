import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import { CRONS } from "@teak/convex/cronSchedules";
import { exportArtifactObjectKeys } from "@teak/convex/export/artifactKey";
import { TRASH_RETENTION_MS } from "@teak/convex/shared/constants";
import { cardStorageObjectKeys } from "@teak/convex/storage/cardObjectKeys";
import type { ConvexRpc } from "../convexRpc";
import { sha256Hex } from "../lib";
import { reportBackgroundError } from "../telemetry";
import {
  type FilesOpCaller,
  resolveDeps,
  type WorkflowDeps,
  withinBudget,
} from "./deps";
import { DUPLICATE_INSTANCE_CODES, workflowBinding } from "./dispatch";
import type { FilesOpOutcome } from "./filesOps";
import {
  type BackgroundEnv,
  CONVEX_STEP,
  errorMessage,
  retryConfig,
  type WorkflowRun,
} from "./runtime";

export const MAINTENANCE_TASKS = [
  "card-cleanup",
  "export-cleanup",
  "orphan-sweep",
  "receipt-cleanup",
] as const;
export type MaintenanceTask = (typeof MAINTENANCE_TASKS)[number];

export interface MaintenanceParams {
  task: MaintenanceTask;
}

const HEARTBEAT_NAMES: Record<MaintenanceTask, string> = {
  "card-cleanup": CRONS.cleanupOldDeletedCards.name,
  "export-cleanup": CRONS.cleanupExpiredExports.name,
  "orphan-sweep": CRONS.sweepOrphanedObjects.name,
  "receipt-cleanup": CRONS.cleanupInboundEmailReceipts.name,
};

const CARD_CLEANUP_BATCH = 10;
const EXPORT_CLEANUP_BATCH = 25;
const ITEM_CLEANUP_PAGE_SIZE = 200;
const MAX_PAGES = 1000;
const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_CARDS_PAGE_SIZE = 500;
const SWEEP_LIST_LIMIT = 1000;
const MAX_SWEEP_CARD_PAGES = 4000;
const MAX_SWEEP_LIST_PAGES = 2000;
const SWEEP_STEP = retryConfig(3, 60_000, "30 minutes");

export const startMaintenanceTask = async (
  env: BackgroundEnv,
  convexSiteUrl: string,
  task: MaintenanceTask,
  now: Date = new Date()
): Promise<void> => {
  const workflows = workflowBinding(env, "maintenance");
  if (!workflows) {
    throw new Error("workflow_missing:maintenance");
  }
  const deployment = (await sha256Hex(convexSiteUrl)).slice(0, 8);
  const id = `${task}-${now.toISOString().slice(0, 10)}-${deployment}`;
  const { errors } = await workflows.createBatch({
    instances: [{ id, params: { convexSiteUrl, task } }],
  });
  const failure = errors.find(
    (error) => !DUPLICATE_INSTANCE_CODES.has(error.code)
  );
  if (failure) {
    throw new Error(`maintenance_start_failed:${failure.message}`);
  }
};

interface TaskContext {
  convex: ConvexRpc;
  ops: FilesOpCaller;
  run: WorkflowRun<MaintenanceParams>;
}

const cleanUpCards = async ({ convex, run }: TaskContext) => {
  const { step } = run;
  const cutoff = await step.do("cutoff", async () =>
    Promise.resolve(Date.now() - TRASH_RETENTION_MS)
  );
  let cleaned = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await step.do(
      `clean up cards ${page}`,
      CONVEX_STEP,
      async () => {
        const startedAt = Date.now();
        let deleted = 0;
        for (;;) {
          const candidates = await convex.query(
            internal.card.trashCleanup.getCardsPendingCleanup,
            { limit: CARD_CLEANUP_BATCH, olderThan: cutoff }
          );
          let pageDeleted = 0;
          for (const candidate of candidates) {
            const outcome = await convex.mutation(
              internal.card.trashCleanup.cleanupDeletedCard,
              { cardId: candidate._id, cutoff }
            );
            pageDeleted += outcome.deleted ? 1 : 0;
          }
          deleted += pageDeleted;
          if (candidates.length < CARD_CLEANUP_BATCH || pageDeleted === 0) {
            return { deleted, more: false };
          }
          if (!withinBudget(startedAt)) {
            return { deleted, more: true };
          }
        }
      }
    );
    cleaned += result.deleted;
    if (!result.more) {
      break;
    }
  }
  await step.do("prune card tombstones", CONVEX_STEP, async () => {
    await convex.mutation(
      internal.publicApiTombstones.pruneExpiredCardTombstones,
      {}
    );
    return null;
  });
  return { cleaned };
};

const cleanUpExports = async ({ convex, ops, run }: TaskContext) => {
  const { step } = run;
  const nowMs = await step.do("now", async () => Promise.resolve(Date.now()));
  let expired = 0;
  let failed = 0;
  const skipped = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await step.do(
      `expire exports ${page}`,
      CONVEX_STEP,
      async () => {
        const limit = EXPORT_CLEANUP_BATCH + skipped.size;
        const jobs: Array<{ _id: Id<"exportJobs">; artifactKey?: string }> =
          await convex.query(internal.dataExport.findExpiredReadyJobs, {
            limit,
            nowMs,
          });
        const failedIds: string[] = [];
        let pageExpired = 0;
        for (const job of jobs.filter((row) => !skipped.has(row._id))) {
          if (job.artifactKey) {
            const deleted = await ops({
              op: "delete-objects",
              params: { keys: exportArtifactObjectKeys(job.artifactKey) },
            }).catch((error: unknown) => {
              console.error("[workflows/maintenance] artifact delete failed", {
                error: errorMessage(error),
                jobId: job._id,
              });
              return null;
            });
            if (deleted?.kind !== "ok") {
              failedIds.push(job._id);
              continue;
            }
          }
          for (;;) {
            const items = await convex.mutation(
              internal.dataExport.deleteJobItemsPage,
              { jobId: job._id, numItems: ITEM_CLEANUP_PAGE_SIZE }
            );
            if (!items.hasMore) {
              break;
            }
          }
          await convex.mutation(internal.dataExport.expireJob, {
            jobId: job._id,
          });
          pageExpired += 1;
        }
        return { expired: pageExpired, failedIds, more: jobs.length === limit };
      }
    );
    expired += result.expired;
    failed += result.failedIds.length;
    for (const id of result.failedIds) {
      skipped.add(id);
    }
    if (!result.more) {
      break;
    }
  }
  if (failed > 0) {
    throw new Error(`export_artifact_delete_failed:${String(failed)}`);
  }
  return { expired };
};

const sweepOrphans = async ({ convex, ops }: TaskContext) => {
  const referenced = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SWEEP_CARD_PAGES; page += 1) {
    const cards = await convex.query(
      internal.storage.orphanSweep.pageSweepCards,
      { cursor, numItems: SWEEP_CARDS_PAGE_SIZE }
    );
    for (const card of cards.cards) {
      for (const key of cardStorageObjectKeys(card)) {
        referenced.add(key);
      }
    }
    if (cards.isDone) {
      break;
    }
    cursor = cards.continueCursor;
  }
  for (const key of await convex.query(
    internal.storage.orphanSweep.collectNonCardReferencedKeys,
    {}
  )) {
    referenced.add(key);
  }
  const prefix = await convex.query(
    internal.storage.orphanSweep.listPrefix,
    {}
  );
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  let listCursor: string | null = null;
  let scannedObjects = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  for (let page = 0; page < MAX_SWEEP_LIST_PAGES; page += 1) {
    const listed: FilesOpOutcome<{
      cursor: string | null;
      objects: Array<{ key: string; lastModified: number; size: number }>;
    }> = await ops<{
      cursor: string | null;
      objects: Array<{ key: string; lastModified: number; size: number }>;
    }>({
      op: "list-objects",
      params: {
        limit: SWEEP_LIST_LIMIT,
        prefix,
        ...(listCursor ? { cursor: listCursor } : {}),
      },
    });
    if (listed.kind !== "ok") {
      throw new Error("list_objects_unavailable");
    }
    for (const object of listed.data.objects) {
      scannedObjects += 1;
      if (!referenced.has(object.key) && object.lastModified <= cutoff) {
        orphanCount += 1;
        orphanBytes += object.size;
      }
    }
    listCursor = listed.data.cursor;
    if (!listCursor) {
      break;
    }
  }
  const report = { orphanBytes, orphanCount, scannedObjects };
  await convex.mutation(internal.storage.orphanSweep.logOrphanReport, report);
  return report;
};

const sweepStorage = async (context: TaskContext) => {
  const { convex, run } = context;
  const results = await Promise.allSettled([
    run.step.do("sweep orphaned objects", SWEEP_STEP, () =>
      sweepOrphans(context)
    ),
    run.step.do("sweep vector ledger", SWEEP_STEP, () =>
      convex.action(internal.embedding.sweep.sweepVectorLedger, {})
    ),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
  return null;
};

const pruneEmailReceipts = async ({ convex, run }: TaskContext) => {
  let pruned = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await run.step.do(
      `prune email receipts ${page}`,
      CONVEX_STEP,
      () => convex.mutation(internal.inbound.ingest.pruneReceipts, {})
    );
    pruned += result.deleted;
    if (!result.hasMore) {
      break;
    }
  }
  return { pruned };
};

const TASKS: Record<
  MaintenanceTask,
  (context: TaskContext) => Promise<unknown>
> = {
  "card-cleanup": cleanUpCards,
  "export-cleanup": cleanUpExports,
  "orphan-sweep": sweepStorage,
  "receipt-cleanup": pruneEmailReceipts,
};

export const runMaintenance = async (
  run: WorkflowRun<MaintenanceParams>,
  deps: WorkflowDeps = {}
): Promise<unknown> => {
  const { convex, ops } = resolveDeps(run, deps);
  const { task } = run.params;
  const handler = TASKS[task];
  if (!handler) {
    throw new Error(`unknown_maintenance_task:${String(task)}`);
  }
  const name = HEARTBEAT_NAMES[task];
  const heartbeat = (
    phase: "failed" | "started" | "succeeded",
    error?: string
  ) =>
    run.step
      .do(`heartbeat ${phase}`, CONVEX_STEP, async () => {
        await convex.mutation(internal.adminHealth.recordCronRun, {
          name,
          phase,
          ...(error ? { error: error.slice(0, 500) } : {}),
        });
        return null;
      })
      .catch((heartbeatError: unknown) => {
        console.error("[workflows/maintenance] heartbeat not recorded", {
          error: errorMessage(heartbeatError),
          task,
        });
        return null;
      });

  await heartbeat("started");
  let result: unknown;
  try {
    result = await handler({ convex, ops, run });
  } catch (error) {
    await heartbeat("failed", errorMessage(error));
    await reportBackgroundError(run.env, undefined, error, {
      convexSiteUrl: run.params.convexSiteUrl,
      task: `maintenance:${task}`,
    });
    throw error;
  }
  await heartbeat("succeeded");
  console.log("[workflows/maintenance] done", { result, task });
  return result;
};
