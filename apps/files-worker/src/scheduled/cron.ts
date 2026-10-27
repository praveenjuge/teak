import { internal } from "@teak/convex/_generated/api";
import { CRONS } from "@teak/convex/cronSchedules";
import type { MaintenanceTask } from "@teak/files-protocol";
import { type AiUsageRollupEnv, rollUpAiUsage } from "../ai/aiUsageRollup";
import { type ConvexRpc, convexSiteUrls, createConvexRpc } from "../convexRpc";
import { enqueueAiBackfill } from "../queues/aiBackfill";
import { sweepStalePendingUploads } from "../queues/r2Events";
import { reportBackgroundError } from "../telemetry";
import { startMaintenanceTask } from "../workflows/maintenance";
import {
  cleanUpSearchCaches,
  expireImportUploads,
  expireUploadSessions,
  startIdempotencyCleanup,
} from "./hourlyCleanup";
import { reconcileWorkflows } from "./workflowReconcile";

export type CronEnv = AiUsageRollupEnv;

export interface CronDeps {
  convex?: (convexSiteUrl: string) => ConvexRpc;
  enqueueAiBackfill?: typeof enqueueAiBackfill;
  reconcileWorkflows?: typeof reconcileWorkflows;
  rollUpAiUsage?: typeof rollUpAiUsage;
  startMaintenanceTask?: typeof startMaintenanceTask;
  sweepStalePendingUploads?: typeof sweepStalePendingUploads;
}

type CronName = (typeof CRONS)[keyof typeof CRONS]["name"];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const recordHeartbeat = async (
  convex: ConvexRpc,
  name: CronName,
  phase: "failed" | "started" | "succeeded",
  error?: unknown
) => {
  try {
    await convex.mutation(internal.adminHealth.recordCronRun, {
      name,
      phase,
      ...(error === undefined ? {} : { error: errorMessage(error) }),
    });
  } catch (heartbeatError) {
    console.error("[cron] heartbeat not recorded", {
      error: errorMessage(heartbeatError),
      name,
    });
  }
};

const monitored = async (
  convex: ConvexRpc,
  name: CronName,
  task: () => Promise<unknown>
) => {
  await recordHeartbeat(convex, name, "started");
  try {
    await task();
  } catch (error) {
    await recordHeartbeat(convex, name, "failed", error);
    throw error;
  }
  await recordHeartbeat(convex, name, "succeeded");
};

const SCHEDULE = {
  aiBackfill: CRONS.aiMetadataBackfill.schedule,
  aiUsage: CRONS.aiUsageRollup.schedule,
  cardCleanup: CRONS.cleanupOldDeletedCards.schedule,
  exportCleanup: CRONS.cleanupExpiredExports.schedule,
  hourly: CRONS.reconcileWorkflows.schedule,
  weekly: CRONS.sweepOrphanedObjects.schedule,
} as const;

export const handleScheduled = async (
  controller: Pick<ScheduledController, "cron" | "scheduledTime">,
  env: CronEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: CronDeps = {}
): Promise<void> => {
  const convexFor = (url: string) =>
    deps.convex?.(url) ?? createConvexRpc(env, url);
  const now = new Date(controller.scheduledTime);
  const maintenance = (task: MaintenanceTask) => (url: string) =>
    (deps.startMaintenanceTask ?? startMaintenanceTask)(env, url, task, now);
  const monitoredTask =
    (
      name: CronName,
      task: (url: string, convex: ConvexRpc) => Promise<unknown>
    ) =>
    (url: string) => {
      const convex = convexFor(url);
      return monitored(convex, name, () => task(url, convex));
    };

  const forEachDeployment = async (
    task: string,
    run: (url: string) => Promise<unknown>
  ) => {
    const urls = convexSiteUrls(env);
    const results = await Promise.allSettled(urls.map((url) => run(url)));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        console.error("[cron] task failed", {
          error: errorMessage(result.reason),
          task,
        });
        await reportBackgroundError(env, ctx, result.reason, {
          convexSiteUrl: urls[index] ?? "",
          cron: controller.cron,
          task,
        });
      }
    }
  };

  switch (controller.cron) {
    // The admin snapshot shares this trigger (CRONS.adminDailySnapshot).
    case SCHEDULE.cardCleanup:
      await Promise.all([
        forEachDeployment("card-cleanup", maintenance("card-cleanup")),
        forEachDeployment("admin-snapshot", maintenance("admin-snapshot")),
      ]);
      return;
    case SCHEDULE.exportCleanup:
      await Promise.all([
        forEachDeployment("export-cleanup", maintenance("export-cleanup")),
        forEachDeployment("receipt-cleanup", maintenance("receipt-cleanup")),
      ]);
      return;
    case SCHEDULE.weekly:
      await Promise.all([
        forEachDeployment("orphan-sweep", maintenance("orphan-sweep")),
        sweepPendingUploads(env, ctx, convexFor, deps),
      ]);
      return;
    case SCHEDULE.aiBackfill:
      await forEachDeployment(
        "ai-backfill",
        monitoredTask(CRONS.aiMetadataBackfill.name, (url) =>
          (deps.enqueueAiBackfill ?? enqueueAiBackfill)(env, url)
        )
      );
      return;
    case SCHEDULE.aiUsage:
      if (!(env.ANALYTICS_ACCOUNT_ID && env.ANALYTICS_API_TOKEN)) {
        console.log("[cron] AI usage rollup skipped: SQL API not configured");
        return;
      }
      await forEachDeployment(
        "ai-usage-rollup",
        monitoredTask(CRONS.aiUsageRollup.name, (url, convex) =>
          (deps.rollUpAiUsage ?? rollUpAiUsage)(env, url, { convex })
        )
      );
      return;
    case SCHEDULE.hourly:
      await Promise.all([
        forEachDeployment(
          "reconcile-workflows",
          monitoredTask(CRONS.reconcileWorkflows.name, async (_url, convex) => {
            const summary = await (
              deps.reconcileWorkflows ?? reconcileWorkflows
            )(env, convex);
            console.log("[cron] workflows reconciled", summary);
          })
        ),
        forEachDeployment(
          "cleanup-expired-idempotency",
          monitoredTask(
            CRONS.cleanupExpiredIdempotency.name,
            async (_url, convex) => {
              const report = await startIdempotencyCleanup(convex);
              console.log("[cron] idempotency cleanup", report);
            }
          )
        ),
        forEachDeployment(
          "cleanup-abandoned-import-uploads",
          monitoredTask(
            CRONS.cleanupAbandonedImportUploads.name,
            async (_url, convex) => {
              const expired = await expireImportUploads(env, convex);
              console.log("[cron] import uploads expired", { expired });
            }
          )
        ),
        forEachDeployment(
          "cleanup-expired-upload-sessions",
          monitoredTask(
            CRONS.cleanupExpiredUploadSessions.name,
            async (_url, convex) => {
              const cleaned = await expireUploadSessions(env, convex);
              console.log("[cron] upload sessions expired", { cleaned });
            }
          )
        ),
        forEachDeployment(
          "cleanup-semantic-search-cache",
          monitoredTask(
            CRONS.cleanupSemanticSearchCache.name,
            async (_url, convex) => {
              const deleted = await cleanUpSearchCaches(convex);
              console.log("[cron] search caches cleaned", deleted);
            }
          )
        ),
      ]);
      return;
    default:
      console.error("[cron] no task", { cron: controller.cron });
  }
};

const sweepPendingUploads = async (
  env: CronEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  convexFor: (url: string) => ConvexRpc,
  deps: CronDeps
) => {
  const name = CRONS.sweepStalePendingUploads.name;
  const deployments = convexSiteUrls(env).map(convexFor);
  await Promise.all(
    deployments.map((convex) => recordHeartbeat(convex, name, "started"))
  );
  try {
    const summary = await (
      deps.sweepStalePendingUploads ?? sweepStalePendingUploads
    )(env);
    console.log("[cron] pending uploads swept", summary);
  } catch (error) {
    await Promise.all(
      deployments.map((convex) =>
        recordHeartbeat(convex, name, "failed", error)
      )
    );
    console.error("[cron] pending upload sweep failed", {
      error: errorMessage(error),
    });
    await reportBackgroundError(env, ctx, error, {
      task: "sweep-stale-pending-uploads",
    });
    return;
  }
  await Promise.all(
    deployments.map((convex) => recordHeartbeat(convex, name, "succeeded"))
  );
};
