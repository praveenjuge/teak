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

export const runOccContentionBackfills = migrations.runner([
  internal.migrations.backfillUserCardUsage,
  internal.migrations.backfillCardSearchDocuments,
]);
