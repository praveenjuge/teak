import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { getOrInitializeCardUsage } from "./card/cardUsage";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillUserCardUsage = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    await getOrInitializeCardUsage(ctx, card.userId);
  },
});

export const backfillCardSearchDocuments = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    await syncCardSearchDocumentHandler(ctx, card._id);
  },
});

export const rollbackUserCardUsage = migrations.define({
  table: "userCardUsage",
  batchSize: 20,
  migrateOne: async (ctx, usage) => {
    await ctx.db.delete("userCardUsage", usage._id);
  },
});

export const rollbackCardSearchDocuments = migrations.define({
  table: "cardSearchDocuments",
  batchSize: 20,
  migrateOne: async (ctx, document) => {
    await ctx.db.delete("cardSearchDocuments", document._id);
  },
});

export const runOccContentionBackfills = migrations.runner([
  internal.migrations.backfillUserCardUsage,
  internal.migrations.backfillCardSearchDocuments,
]);

export const runOccContentionRollback = migrations.runner([
  internal.migrations.rollbackUserCardUsage,
  internal.migrations.rollbackCardSearchDocuments,
]);
