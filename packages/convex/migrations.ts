import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import type { DataModel, Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import {
  CARD_USAGE_TOTAL_SHARDS,
  getCardUsage,
  initializeCardUsageShards,
} from "./card/cardUsage";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import { FREE_TIER_LIMIT } from "./shared/constants";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillUserCardUsage = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    let usage = await getCardUsage(ctx, card.userId);
    if (!usage) {
      const usageId = await ctx.db.insert("userCardUsage", {
        userId: card.userId,
        activeCardCount: 0,
        isCountExact: false,
        isSaturated: false,
        migrationActiveCardCount: 0,
        migrationBackfilledAt: Date.now(),
        migrationCountStartedAt: Date.now(),
        updatedAt: Date.now(),
      });
      usage = await ctx.db.get("userCardUsage", usageId);
    } else if (usage.migrationActiveCardCount === undefined) {
      await ctx.db.patch("userCardUsage", usage._id, {
        migrationActiveCardCount: 0,
        migrationCountStartedAt: Date.now(),
      });
      usage = await ctx.db.get("userCardUsage", usage._id);
    }
    if (!usage) {
      throw new Error("Failed to initialize usage migration");
    }
    const existingEntry = await ctx.db
      .query("cardUsageMigrationEntries")
      .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
      .unique();
    if (existingEntry) {
      return;
    }
    const countedActive = !card.isDeleted;
    await ctx.db.insert("cardUsageMigrationEntries", {
      cardId: card._id,
      userId: card.userId,
      countedActive,
      createdAt: Date.now(),
    });
    if (countedActive) {
      await ctx.db.patch("userCardUsage", usage._id, {
        migrationActiveCardCount: (usage.migrationActiveCardCount ?? 0) + 1,
      });
    }
  },
});

export const finalizeUserCardUsage = migrations.define({
  table: "userCardUsage",
  batchSize: 20,
  migrateOne: async (ctx, usage) => {
    if (usage.migrationActiveCardCount === undefined) {
      return;
    }
    await ctx.db.patch("userCardUsage", usage._id, {
      activeCardCount: usage.migrationActiveCardCount,
      isCountExact: true,
      isSaturated: usage.migrationActiveCardCount >= FREE_TIER_LIMIT,
      migrationActiveCardCount: undefined,
      migrationCountStartedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const backfillCardSearchDocuments = migrations.define({
  table: "cards",
  batchSize: 10,
  migrateOne: async (ctx, card) => {
    await syncCardSearchDocumentHandler(ctx, card._id, {
      migrationBackfill: true,
    });
  },
});

export const backfillUserCardUsageShardsHandler = async (
  ctx: MutationCtx,
  usage: Doc<"userCardUsage">
) => {
  if (!usage.isCountExact) {
    throw new Error("Card usage must be exact before sharding");
  }
  await initializeCardUsageShards(ctx, usage);
};

export const backfillUserCardUsageShards = migrations.define({
  table: "userCardUsage",
  batchSize: 20,
  migrateOne: backfillUserCardUsageShardsHandler,
});

export const rollbackUserCardUsageShardsHandler = async (
  ctx: MutationCtx,
  usage: Doc<"userCardUsage">
) => {
  let activeCardCount = 0;
  const shards: Doc<"userCardUsageShards">[] = [];
  for (let shard = 0; shard < CARD_USAGE_TOTAL_SHARDS; shard += 1) {
    const usageShard = await ctx.db
      .query("userCardUsageShards")
      .withIndex("by_userId_and_shard", (query) =>
        query.eq("userId", usage.userId).eq("shard", shard)
      )
      .unique();
    if (usageShard) {
      activeCardCount += usageShard.activeCardCount;
      shards.push(usageShard);
    }
  }
  if (shards.length === 0) {
    if (usage.shardVersion !== undefined || usage.shardedAt !== undefined) {
      throw new Error("Card usage shard set is incomplete");
    }
    return;
  }
  if (shards.length !== CARD_USAGE_TOTAL_SHARDS) {
    throw new Error("Card usage shard set is incomplete");
  }
  await ctx.db.patch("userCardUsage", usage._id, {
    activeCardCount,
    isCountExact: true,
    isSaturated: activeCardCount >= FREE_TIER_LIMIT,
    shardVersion: undefined,
    shardedAt: undefined,
    updatedAt: Date.now(),
  });
  for (const usageShard of shards) {
    await ctx.db.delete("userCardUsageShards", usageShard._id);
  }
};

export const rollbackUserCardUsageShards = migrations.define({
  table: "userCardUsage",
  batchSize: 20,
  migrateOne: rollbackUserCardUsageShardsHandler,
});

export const rollbackUserCardUsage = migrations.define({
  table: "userCardUsage",
  batchSize: 20,
  migrateOne: async (ctx, usage) => {
    if (usage.migrationBackfilledAt === undefined) {
      await ctx.db.patch("userCardUsage", usage._id, {
        migrationActiveCardCount: undefined,
        migrationCountStartedAt: undefined,
      });
    } else {
      await ctx.db.delete("userCardUsage", usage._id);
    }
  },
});

export const rollbackCardUsageMigrationEntries = migrations.define({
  table: "cardUsageMigrationEntries",
  batchSize: 20,
  migrateOne: async (ctx, entry) => {
    await ctx.db.delete("cardUsageMigrationEntries", entry._id);
  },
});

export const rollbackCardSearchDocuments = migrations.define({
  table: "cardSearchDocuments",
  batchSize: 20,
  migrateOne: async (ctx, document) => {
    if (document.migrationBackfilledAt !== undefined) {
      await ctx.db.delete("cardSearchDocuments", document._id);
    }
  },
});

export const runOccContentionBackfills = migrations.runner([
  internal.migrations.backfillUserCardUsage,
  internal.migrations.finalizeUserCardUsage,
  internal.migrations.backfillCardSearchDocuments,
]);

export const runOccContentionRollback = migrations.runner([
  internal.migrations.rollbackCardUsageMigrationEntries,
  internal.migrations.rollbackUserCardUsage,
  internal.migrations.rollbackCardSearchDocuments,
]);

export const runCardUsageShardBackfill = migrations.runner([
  internal.migrations.backfillUserCardUsageShards,
]);

export const runCardUsageShardRollback = migrations.runner([
  internal.migrations.rollbackUserCardUsageShards,
]);
