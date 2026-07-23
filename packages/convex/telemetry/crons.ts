"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { type CronCheckInConfig, withCronCheckIn } from "./sentry";

const internalAny = internal as Record<string, any>;

export const CRON_MONITORS = {
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
  ensureOauthClients: {
    checkinMarginMinutes: 15,
    maxRuntimeMinutes: 5,
    schedule: "*/15 * * * *",
    slug: "ensure-oauth-clients",
  },
} as const satisfies Record<string, CronCheckInConfig>;

const monitored = async (
  config: CronCheckInConfig,
  callback: () => Promise<unknown>
): Promise<null> => {
  await withCronCheckIn(config, callback);
  return null;
};

export const ensureOauthClients = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) =>
    monitored(CRON_MONITORS.ensureOauthClients, () =>
      ctx.runMutation(internalAny.oauthClients.ensureOAuthClients, {})
    ),
});

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
