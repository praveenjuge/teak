"use node";

import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { type ActionCtx, env, internalAction } from "../_generated/server";
import { sweepStalePendingUploadsHandler } from "../storage/pendingUploadCleanup";
import { type CronCheckInConfig, withCronCheckIn } from "./sentry";

const internalAny = internal as Record<string, any>;

export const CRON_MONITORS = {
  cleanupExpiredIdempotency: {
    checkinMarginMinutes: 10,
    maxRuntimeMinutes: 10,
    schedule: "10 * * * *",
    slug: "cleanup-expired-idempotency",
  },
  cleanupExpiredNativeAuthCodes: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 10,
    schedule: "30 6 * * *",
    slug: "cleanup-expired-native-auth-codes",
  },
  aiMetadataBackfill: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 30,
    schedule: "0 */6 * * *",
    slug: "ai-metadata-backfill",
  },
  cleanupAbandonedImportUploads: {
    checkinMarginMinutes: 10,
    maxRuntimeMinutes: 20,
    schedule: "0 * * * *",
    slug: "cleanup-abandoned-import-uploads",
  },
  cleanupExpiredExports: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 30,
    schedule: "0 3 * * *",
    slug: "cleanup-expired-exports",
  },
  cleanupOldDeletedCards: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 30,
    schedule: "0 2 * * *",
    slug: "cleanup-old-deleted-cards",
  },
  cleanupStalePendingCardUploads: {
    checkinMarginMinutes: 10,
    maxRuntimeMinutes: 20,
    schedule: "30 * * * *",
    slug: "cleanup-stale-pending-card-uploads",
  },
  sweepOrphanedObjects: {
    checkinMarginMinutes: 30,
    maxRuntimeMinutes: 60,
    schedule: "0 4 * * 1",
    slug: "sweep-orphaned-objects",
  },
  reapStuckWorkflows: {
    checkinMarginMinutes: 30,
    maxRuntimeMinutes: 30,
    schedule: "0 5 * * 1",
    slug: "reap-stuck-workflows",
  },
  cleanupResendEmails: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 10,
    schedule: "0 6 * * *",
    slug: "cleanup-resend-emails",
  },
  redriveAccountDeletion: {
    checkinMarginMinutes: 5,
    maxRuntimeMinutes: 5,
    failureIssueThreshold: 2,
    schedule: "*/5 * * * *",
    slug: "redrive-account-deletion",
  },
  workosDailyReconciliationAudit: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 10,
    schedule: "30 4 * * *",
    slug: "workos-daily-reconciliation-audit",
  },
} as const satisfies Record<string, CronCheckInConfig>;

export const cleanupExpiredIdempotency = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupExpiredIdempotency, async () => {
      if (env.OPERATIONAL_RETENTION_ENABLED !== "true") {
        return;
      }
      await ctx.runMutation(
        internal.operationalRetention.cleanupExpiredRecords,
        {
          kind: "idempotency",
          dryRun: false,
        }
      );
    }),
});

export const cleanupExpiredNativeAuthCodes = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupExpiredNativeAuthCodes, async () => {
      if (env.OPERATIONAL_RETENTION_ENABLED !== "true") {
        return;
      }
      await ctx.runMutation(
        internal.operationalRetention.cleanupExpiredRecords,
        {
          kind: "nativeAuthCodes",
          dryRun: false,
        }
      );
    }),
});

const monitored = async (
  config: CronCheckInConfig,
  callback: () => Promise<unknown>
): Promise<null> => {
  await withCronCheckIn(config, callback);
  return null;
};

export const cleanupOldDeletedCards = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupOldDeletedCards, () =>
      ctx.runMutation(
        internalAny.workflows.cardCleanup.startCardCleanupWorkflow,
        {}
      )
    ),
});

export const cleanupAbandonedImportUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupAbandonedImportUploads, () =>
      ctx.runAction(internalAny["import/runImport"].cleanupExpiredUploads, {})
    ),
});

export const cleanupStalePendingCardUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupStalePendingCardUploads, async () => {
      await sweepStalePendingUploadsHandler(ctx);
      await ctx.runAction(
        internalAny.fileUploads.cleanupExpiredMultipartUploads,
        {}
      );
    }),
});

export const sweepOrphanedObjects = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.sweepOrphanedObjects, async () => {
      await ctx.runAction(
        internalAny["workflows/orphanSweep"].sweepOrphanedObjects,
        {}
      );
      return null;
    }),
});

export const aiMetadataBackfill = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.aiMetadataBackfill, () =>
      ctx.runMutation(
        internalAny.workflows.aiBackfill.startAiBackfillWorkflow,
        {}
      )
    ),
});

export const reapStuckWorkflows = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.reapStuckWorkflows, async () => {
      await ctx.runAction(
        internalAny["workflows/manager"].reapStuckWorkflows,
        {}
      );
      return null;
    }),
});

export const cleanupExpiredExports = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupExpiredExports, () =>
      ctx.runMutation(
        internalAny.workflows.exportCleanup.startExportCleanupWorkflow,
        {}
      )
    ),
});

export const cleanupResendEmails = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.cleanupResendEmails, async () => {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      await ctx.runMutation(components.resend.lib.cleanupOldEmails, {
        olderThan: oneWeekMs,
      });
      await ctx.runMutation(components.resend.lib.cleanupAbandonedEmails, {
        olderThan: 4 * oneWeekMs,
      });
    }),
});

export const redriveAccountDeletion = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.redriveAccountDeletion, () =>
      ctx.runMutation(internal.accountDeletionJobs.redrive, {})
    ),
});

export const workosDailyReconciliationAudit = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.workosDailyReconciliationAudit, async () => {
      const result = await ctx.runAction(
        internal.workosReconciliationSchedule.dailyAudit,
        {}
      );
      if (result.status.endsWith("_requires_operator")) {
        throw new Error(result.status);
      }
    }),
});
