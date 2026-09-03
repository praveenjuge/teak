import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalQuery } from "./_generated/server.js";
import { syncCardSearchTagsBatchHandler } from "./card/searchDocumentHelpers";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillCardSearchTags = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    await syncCardSearchTagsBatchHandler(ctx, card._id);
  },
});

export const rollbackCardSearchTags = migrations.define({
  table: "cardSearchTags",
  batchSize: 20,
  migrateOne: async (ctx, tagDocument) => {
    await ctx.db.delete("cardSearchTags", tagDocument._id);
  },
});

export const runCardSearchTagBackfill = migrations.runner([
  internal.migrations.backfillCardSearchTags,
]);

export const runCardSearchTagRollback = migrations.runner([
  internal.migrations.rollbackCardSearchTags,
]);

export const getCardSearchTagBackfillStatus = internalQuery({
  args: {},
  returns: v.object({
    hasPendingSyncs: v.boolean(),
    migrationDone: v.boolean(),
    migrationError: v.optional(v.string()),
    readyForParityCheck: v.boolean(),
  }),
  handler: async (ctx) => {
    const [pendingSync, statuses] = await Promise.all([
      ctx.db.query("cardSearchTagSyncStates").first(),
      migrations.getStatus(ctx, {
        migrations: [internal.migrations.backfillCardSearchTags],
      }),
    ]);
    const status = statuses[0];
    const migrationDone = status?.state === "success" && status.isDone;
    const hasPendingSyncs = pendingSync !== null;
    return {
      hasPendingSyncs,
      migrationDone,
      migrationError: status?.error,
      readyForParityCheck: migrationDone && !hasPendingSyncs,
    };
  },
});
