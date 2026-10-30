import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  autoInternalUserIds,
  createOverviewTally,
  createSnapshotTally,
  type MetricsUserRow,
  type OverviewCardRow,
  snapshotDay,
  snapshotTakesBilling,
  toMetricsCardRow,
} from "@teak/convex/admin/stats";
import { CRONS } from "@teak/convex/cronSchedules";
import { exportArtifactObjectKeys } from "@teak/convex/export/artifactKey";
import { TRASH_RETENTION_MS } from "@teak/convex/shared/constants";
import { cardStorageObjectKeys } from "@teak/convex/storage/cardObjectKeys";
import type { MaintenanceParams, MaintenanceTask } from "@teak/files-protocol";
import type { FunctionArgs } from "convex/server";
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
  runReported,
  type WorkflowRun,
} from "./runtime";

const HEARTBEAT_NAMES: Record<MaintenanceTask, string> = {
  "card-cleanup": CRONS.cleanupOldDeletedCards.name,
  "export-cleanup": CRONS.cleanupExpiredExports.name,
  "orphan-sweep": CRONS.sweepOrphanedObjects.name,
  "receipt-cleanup": CRONS.cleanupInboundEmailReceipts.name,
  "admin-snapshot": CRONS.adminDailySnapshot.name,
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
const SWEEP_REFERENCE_PAGE_SIZE = 100;
const MAX_SWEEP_REFERENCE_PAGES = 4000;
const SWEEP_STEP = retryConfig(3, 60_000, "30 minutes");
// The admin metrics scans read at most 400 pages of 500 cards, as the Convex
// action they replaced did; a longer scan marks its result approximate.
const MAX_METRICS_PAGES = 400;
const FLAG_BATCH = 200;
const METRICS_STEP = retryConfig(3, 60_000, "30 minutes");
const BILLING_STEP = retryConfig(3, 30_000, "5 minutes");

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

const REFERENCE_SOURCES: FunctionArgs<
  typeof internal.storage.orphanSweep.pageNonCardReferencedKeys
>["source"][] = [
  "uploads",
  "imports",
  "pendingLinkedPdfs",
  "failedLinkedPdfs",
  "exports",
];

const collectNonCardReferences = async (
  convex: ConvexRpc,
  referenced: Set<string>
) => {
  for (const source of REFERENCE_SOURCES) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_SWEEP_REFERENCE_PAGES; page += 1) {
      const result: {
        continueCursor: string;
        isDone: boolean;
        keys: string[];
      } = await convex.query(
        internal.storage.orphanSweep.pageNonCardReferencedKeys,
        { cursor, numItems: SWEEP_REFERENCE_PAGE_SIZE, source }
      );
      for (const key of result.keys) {
        referenced.add(key);
      }
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
  }
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
  await collectNonCardReferences(convex, referenced);
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

interface Page<T> {
  continueCursor: string;
  isDone: boolean;
  rows: T[];
}

/** Visits up to MAX_METRICS_PAGES pages; true when it reached the end. */
const visitPages = async <T>(
  readPage: (cursor: string | null) => Promise<Page<T>>,
  visit: (rows: T[]) => void
): Promise<boolean> => {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_METRICS_PAGES; page += 1) {
    const result: Page<T> = await readPage(cursor);
    visit(result.rows);
    if (result.isDone) {
      return true;
    }
    cursor = result.continueCursor;
  }
  return false;
};

/**
 * Counts the day's snapshot and `admin:getOverview`'s result (with and
 * without onboarding cards) from one scan of every card, so the overview
 * reads nothing more from Convex. The snapshot leaves onboarding cards out.
 */
const countSnapshot = async (
  convex: ConvexRpc,
  window: ReturnType<typeof snapshotDay>,
  now: number
) => {
  const users: MetricsUserRow[] = [];
  const usersComplete = await visitPages<MetricsUserRow>(
    (cursor) => convex.query(internal.adminMetrics.usersPage, { cursor }),
    (rows) => users.push(...rows)
  );
  const autoInternal = autoInternalUserIds(users);
  for (let i = 0; i < autoInternal.length; i += FLAG_BATCH) {
    await convex.mutation(internal.adminAccess.flagAutoInternalAccounts, {
      teakUserIds: autoInternal.slice(i, i + FLAG_BATCH),
    });
  }
  const internalIds = new Set<string>(
    await convex.query(internal.adminAccess.listInternalUserIds, {})
  );
  const tally = createSnapshotTally({ ...window, internalIds });
  for (const user of users) {
    tally.addUser(user);
  }
  const withOnboarding = createOverviewTally(now);
  const withoutOnboarding = createOverviewTally(now);
  const cardsComplete = await visitPages<OverviewCardRow>(
    (cursor) => convex.query(internal.admin.overviewCardsPage, { cursor }),
    (rows) => {
      for (const card of rows) {
        if (!card.onboarding) {
          tally.addCard(toMetricsCardRow(card));
        }
        if (internalIds.has(card.userId)) {
          continue;
        }
        withOnboarding.add(card);
        if (!card.onboarding) {
          withoutOnboarding.add(card);
        }
      }
    }
  );
  for (const row of await convex.query(internal.adminUsage.usageForDay, {
    date: window.day,
  })) {
    tally.addUsage(row);
  }
  return {
    counts: tally.counts(),
    isComplete: usersComplete && cardsComplete,
    overviews: [
      {
        includeOnboarding: true,
        overview: withOnboarding.finish(!(usersComplete && cardsComplete)),
      },
      {
        includeOnboarding: false,
        overview: withoutOnboarding.finish(!(usersComplete && cardsComplete)),
      },
    ],
  };
};

/**
 * The day's `adminDailyMetrics` row, and the current `adminOverviews` rows
 * from the same scan. Billing comes from Convex (Polar). An admin's capture
 * of any day refreshes the overview too, since the scan is already done.
 */
const captureSnapshot = async ({ convex, run }: TaskContext) => {
  const { step } = run;
  const now = await step.do("now", async () => Promise.resolve(Date.now()));
  const window = snapshotDay(run.params.date, now);
  const { counts, isComplete, overviews } = await step.do(
    "count snapshot",
    METRICS_STEP,
    () => countSnapshot(convex, window, now)
  );
  await step.do("write overview", CONVEX_STEP, async () => {
    for (const overview of overviews) {
      await convex.mutation(internal.admin.writeOverview, overview);
    }
    return null;
  });
  const billing = snapshotTakesBilling(window.dayEnd, now)
    ? await step.do("read billing", BILLING_STEP, () =>
        convex.action(internal.adminMetrics.readSnapshotBilling, {})
      )
    : { billing: null, isComplete: true };
  const isApproximate = !(isComplete && billing.isComplete);
  await step.do("write snapshot", CONVEX_STEP, async () => {
    await convex.mutation(internal.adminMetrics.writeSnapshot, {
      snapshot: {
        date: window.day,
        capturedAt: now,
        ...counts,
        ...(billing.billing ? { billing: billing.billing } : {}),
        isApproximate,
      },
    });
    return null;
  });
  return { date: window.day, isApproximate };
};

const TASKS: Record<
  MaintenanceTask,
  (context: TaskContext) => Promise<unknown>
> = {
  "card-cleanup": cleanUpCards,
  "export-cleanup": cleanUpExports,
  "orphan-sweep": sweepStorage,
  "receipt-cleanup": pruneEmailReceipts,
  "admin-snapshot": captureSnapshot,
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
  // A run Convex started on request is not the cron, so it leaves the cron's
  // health alone and reports to its dispatch row instead.
  const dispatched = run.params.dispatched === true;
  const heartbeat = (
    phase: "failed" | "started" | "succeeded",
    error?: string
  ) =>
    dispatched
      ? Promise.resolve(null)
      : run.step
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

  const execute = async () => {
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
  return dispatched ? await runReported(run, execute, convex) : await execute();
};
