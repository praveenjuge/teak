import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalQuery } from "./_generated/server.js";
import {
  isCardSearchTagSyncEnabled,
  restartCardSearchTagSync,
  syncCardSearchTagsBatchHandler,
} from "./card/searchDocumentHelpers";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillCardSearchTags = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    await restartCardSearchTagSync(ctx, card._id, card.updatedAt);
    await syncCardSearchTagsBatchHandler(ctx, card._id);
  },
});

export const runCardSearchTagBackfill = migrations.runner([
  internal.migrations.backfillCardSearchTags,
]);

const assertCardSearchTagSyncDisabled = () => {
  if (isCardSearchTagSyncEnabled()) {
    throw new Error(
      "Set CARD_SEARCH_TAG_SYNC_DISABLED=true before rolling back search tags"
    );
  }
};

export const rollbackCardSearchTagSyncStates = migrations.define({
  table: "cardSearchTagSyncStates",
  batchSize: 20,
  migrateOne: async (ctx, state) => {
    assertCardSearchTagSyncDisabled();
    await ctx.db.delete("cardSearchTagSyncStates", state._id);
  },
});

export const rollbackCardSearchTags = migrations.define({
  table: "cardSearchTags",
  batchSize: 20,
  migrateOne: async (ctx, tagDocument) => {
    assertCardSearchTagSyncDisabled();
    await ctx.db.delete("cardSearchTags", tagDocument._id);
  },
});

export const runCardSearchTagRollback = migrations.runner([
  internal.migrations.rollbackCardSearchTagSyncStates,
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
      ctx.db
        .query("cardSearchTagSyncStates")
        .withIndex("by_pending", (query) => query.eq("pending", true))
        .first(),
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
