import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "../shared/constants";

export const CARD_USAGE_SCAN_LIMIT = FREE_TIER_LIMIT + 1;
export const CARD_USAGE_BASE_SHARDS = 16;
export const CARD_USAGE_OVERFLOW_SHARDS = 8;
export const CARD_USAGE_TOTAL_SHARDS =
  CARD_USAGE_BASE_SHARDS + CARD_USAGE_OVERFLOW_SHARDS;
export const CARD_USAGE_SHARD_VERSION = 1;

type DatabaseReaderCtx = Pick<MutationCtx | QueryCtx, "db">;

const getCardUsageMigrationEntry = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const indexedQuery = ctx.db
    .query("cardUsageMigrationEntries")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId));
  if (typeof indexedQuery.unique !== "function") {
    return null;
  }
  return await indexedQuery.unique();
};

export const getCardUsage = async (ctx: DatabaseReaderCtx, userId: string) =>
  await ctx.db
    .query("userCardUsage")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();

const getCardUsageShard = async (
  ctx: DatabaseReaderCtx,
  userId: string,
  shard: number
) => {
  const indexedQuery = ctx.db
    .query("userCardUsageShards")
    .withIndex("by_userId_and_shard", (query) =>
      query.eq("userId", userId).eq("shard", shard)
    );
  if (typeof indexedQuery.unique !== "function") {
    return null;
  }
  return await indexedQuery.unique();
};

const getRequiredCardUsageShard = async (
  ctx: DatabaseReaderCtx,
  userId: string,
  shard: number
) => {
  const usageShard = await getCardUsageShard(ctx, userId, shard);
  if (!usageShard) {
    throw new Error(`Card usage shard ${shard} is missing for user`);
  }
  return usageShard;
};

export const initializeCardUsageShards = async (
  ctx: MutationCtx,
  usage: Doc<"userCardUsage">
) => {
  const existingShards = await ctx.db
    .query("userCardUsageShards")
    .withIndex("by_userId_and_shard", (query) =>
      query.eq("userId", usage.userId)
    )
    .take(CARD_USAGE_TOTAL_SHARDS + 1);
  if (usage.shardVersion === CARD_USAGE_SHARD_VERSION) {
    const shardNumbers = new Set(existingShards.map((shard) => shard.shard));
    if (
      existingShards.length !== CARD_USAGE_TOTAL_SHARDS ||
      shardNumbers.size !== CARD_USAGE_TOTAL_SHARDS ||
      [...shardNumbers].some(
        (shard) => shard < 0 || shard >= CARD_USAGE_TOTAL_SHARDS
      )
    ) {
      throw new Error("Card usage shard set is incomplete");
    }
    return false;
  }
  if (usage.shardVersion !== undefined || usage.shardedAt !== undefined) {
    throw new Error("Card usage shard version is unsupported");
  }
  if (!usage.isCountExact) {
    throw new Error("Card usage must be exact before sharding");
  }
  for (const existingShard of existingShards) {
    await ctx.db.delete("userCardUsageShards", existingShard._id);
  }

  const { activeCardCount, userId } = usage;
  const cappedCount = Math.min(activeCardCount, FREE_TIER_LIMIT);
  const overflowCount = Math.max(0, activeCardCount - FREE_TIER_LIMIT);
  const now = Date.now();
  for (let shard = 0; shard < CARD_USAGE_TOTAL_SHARDS; shard += 1) {
    const isOverflow = shard >= CARD_USAGE_BASE_SHARDS;
    const relativeShard = isOverflow ? shard - CARD_USAGE_BASE_SHARDS : shard;
    const count = isOverflow ? overflowCount : cappedCount;
    const shardCountForTier = isOverflow
      ? CARD_USAGE_OVERFLOW_SHARDS
      : CARD_USAGE_BASE_SHARDS;
    const shardCount =
      Math.floor(count / shardCountForTier) +
      (relativeShard < count % shardCountForTier ? 1 : 0);
    await ctx.db.insert("userCardUsageShards", {
      userId,
      shard,
      activeCardCount: shardCount,
      updatedAt: now,
    });
  }
  await ctx.db.patch("userCardUsage", usage._id, {
    migrationBackfilledAt: undefined,
    shardVersion: CARD_USAGE_SHARD_VERSION,
    shardedAt: now,
    updatedAt: now,
  });
  return true;
};

export const getCardUsageSnapshot = async (
  ctx: DatabaseReaderCtx,
  userId: string
) => {
  const usage = await getCardUsage(ctx, userId);
  if (usage?.shardVersion !== CARD_USAGE_SHARD_VERSION) {
    return usage;
  }
  const shards = await Promise.all(
    Array.from({ length: CARD_USAGE_TOTAL_SHARDS }, (_, shard) =>
      getRequiredCardUsageShard(ctx, userId, shard)
    )
  );
  const activeCardCount = shards.reduce(
    (sum, shard) => sum + shard.activeCardCount,
    0
  );
  return {
    activeCardCount,
    isCountExact: true,
    isSaturated: activeCardCount >= FREE_TIER_LIMIT,
    shardVersion: usage.shardVersion,
    shardedAt: usage.shardedAt,
    updatedAt: Math.max(...shards.map((shard) => shard.updatedAt)),
    userId,
  };
};

const shardForCard = (cardId: Id<"cards">) => {
  let hash = 0;
  for (const character of cardId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }
  return hash;
};

const baseShardCapacity = (shard: number) =>
  Math.floor(FREE_TIER_LIMIT / CARD_USAGE_BASE_SHARDS) +
  (shard < FREE_TIER_LIMIT % CARD_USAGE_BASE_SHARDS ? 1 : 0);

const incrementShardedUsage = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">,
  hasPremium: boolean
) => {
  if (!hasPremium) {
    let overflowActiveCardCount = 0;
    for (let offset = 0; offset < CARD_USAGE_OVERFLOW_SHARDS; offset += 1) {
      const shard = CARD_USAGE_BASE_SHARDS + offset;
      const overflow = await getRequiredCardUsageShard(ctx, userId, shard);
      overflowActiveCardCount += overflow.activeCardCount;
    }
    if (overflowActiveCardCount > 0) {
      let activeCardCount = overflowActiveCardCount;
      for (let shard = 0; shard < CARD_USAGE_BASE_SHARDS; shard += 1) {
        const usage = await getRequiredCardUsageShard(ctx, userId, shard);
        activeCardCount += usage.activeCardCount;
      }
      if (activeCardCount >= FREE_TIER_LIMIT) {
        throw new ConvexError({
          code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
          message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
        });
      }
    }
  }

  const start = shardForCard(cardId) % CARD_USAGE_BASE_SHARDS;
  for (let offset = 0; offset < CARD_USAGE_BASE_SHARDS; offset += 1) {
    const shard = (start + offset) % CARD_USAGE_BASE_SHARDS;
    const usage = await getRequiredCardUsageShard(ctx, userId, shard);
    if (usage.activeCardCount < baseShardCapacity(shard)) {
      await ctx.db.patch("userCardUsageShards", usage._id, {
        activeCardCount: usage.activeCardCount + 1,
        updatedAt: Date.now(),
      });
      return;
    }
  }

  if (!hasPremium) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
  const overflowShard =
    CARD_USAGE_BASE_SHARDS +
    (shardForCard(cardId) % CARD_USAGE_OVERFLOW_SHARDS);
  const overflow = await getRequiredCardUsageShard(ctx, userId, overflowShard);
  await ctx.db.patch("userCardUsageShards", overflow._id, {
    activeCardCount: overflow.activeCardCount + 1,
    updatedAt: Date.now(),
  });
};

const decrementShardedUsage = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
) => {
  const start = shardForCard(cardId);
  for (let offset = 0; offset < CARD_USAGE_OVERFLOW_SHARDS; offset += 1) {
    const shard =
      CARD_USAGE_BASE_SHARDS + ((start + offset) % CARD_USAGE_OVERFLOW_SHARDS);
    const usage = await getRequiredCardUsageShard(ctx, userId, shard);
    if (usage.activeCardCount > 0) {
      await ctx.db.patch("userCardUsageShards", usage._id, {
        activeCardCount: usage.activeCardCount - 1,
        updatedAt: Date.now(),
      });
      return;
    }
  }
  for (let offset = 0; offset < CARD_USAGE_BASE_SHARDS; offset += 1) {
    const shard = (start + offset) % CARD_USAGE_BASE_SHARDS;
    const usage = await getRequiredCardUsageShard(ctx, userId, shard);
    if (usage.activeCardCount > 0) {
      await ctx.db.patch("userCardUsageShards", usage._id, {
        activeCardCount: usage.activeCardCount - 1,
        updatedAt: Date.now(),
      });
      return;
    }
  }
};

export const getOrInitializeCardUsage = async (
  ctx: MutationCtx,
  userId: string,
  options: { migrationBackfill?: boolean } = {}
): Promise<Doc<"userCardUsage">> => {
  const existing = await getCardUsage(ctx, userId);
  if (existing) {
    return existing;
  }

  const activeCards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (query) =>
      query.eq("userId", userId).eq("isDeleted", undefined)
    )
    .take(CARD_USAGE_SCAN_LIMIT);
  const activeCardCount = activeCards.length;
  const id = await ctx.db.insert("userCardUsage", {
    userId,
    activeCardCount,
    isCountExact: activeCards.length < CARD_USAGE_SCAN_LIMIT,
    isSaturated: activeCards.length >= FREE_TIER_LIMIT,
    ...(options.migrationBackfill ? { migrationBackfilledAt: Date.now() } : {}),
    updatedAt: Date.now(),
  });
  const initialized = await ctx.db.get("userCardUsage", id);
  if (!initialized) {
    throw new Error("Failed to initialize card usage");
  }
  return initialized;
};

export const ensureCardUsageShards = async (
  ctx: MutationCtx,
  userId: string,
  hasPremium: boolean
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  if (usage.shardVersion === CARD_USAGE_SHARD_VERSION) {
    return;
  }
  if (
    !hasPremium &&
    (usage.isSaturated ||
      !usage.isCountExact ||
      usage.activeCardCount >= FREE_TIER_LIMIT)
  ) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
  await initializeCardUsageShards(ctx, usage);
};

export const ensureCardUsageShardsForRemoval = async (
  ctx: MutationCtx,
  userId: string
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  if (usage.shardVersion !== CARD_USAGE_SHARD_VERSION && usage.isCountExact) {
    await initializeCardUsageShards(ctx, usage);
  }
};

export const recordActiveCardCreated = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">,
  options: { hasPremium?: boolean } = {}
) => {
  const usage = await getCardUsage(ctx, userId);
  if (usage?.shardVersion === CARD_USAGE_SHARD_VERSION) {
    await incrementShardedUsage(
      ctx,
      userId,
      cardId,
      options.hasPremium ?? false
    );
    return;
  }
  throw new Error("Card usage shards must be initialized before card creation");
};

export const recordActiveCardRemoved = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
) => {
  const usage = await getCardUsage(ctx, userId);
  if (usage?.shardVersion === CARD_USAGE_SHARD_VERSION) {
    await decrementShardedUsage(ctx, userId, cardId);
    return;
  }
  const initializedUsage =
    usage ?? (await getOrInitializeCardUsage(ctx, userId));
  const migrationEntry = await getCardUsageMigrationEntry(ctx, cardId);
  let migrationActiveCardCount = initializedUsage.migrationActiveCardCount;
  if (migrationActiveCardCount !== undefined && migrationEntry?.countedActive) {
    await ctx.db.patch("cardUsageMigrationEntries", migrationEntry._id, {
      countedActive: false,
    });
    migrationActiveCardCount = Math.max(0, migrationActiveCardCount - 1);
  }
  if (initializedUsage.isCountExact ?? !initializedUsage.isSaturated) {
    const nextCount = Math.max(0, initializedUsage.activeCardCount - 1);
    await ctx.db.patch("userCardUsage", initializedUsage._id, {
      activeCardCount: nextCount,
      isCountExact: true,
      isSaturated: nextCount >= FREE_TIER_LIMIT,
      migrationActiveCardCount,
      migrationBackfilledAt: undefined,
      updatedAt: Date.now(),
    });
    return;
  }

  const remaining = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (query) =>
      query.eq("userId", userId).eq("isDeleted", undefined)
    )
    .take(CARD_USAGE_SCAN_LIMIT);
  await ctx.db.patch("userCardUsage", initializedUsage._id, {
    activeCardCount: remaining.length,
    isCountExact: remaining.length < CARD_USAGE_SCAN_LIMIT,
    isSaturated: remaining.length >= FREE_TIER_LIMIT,
    migrationActiveCardCount,
    migrationBackfilledAt: undefined,
    updatedAt: Date.now(),
  });
};

export const removeCardUsage = async (ctx: MutationCtx, userId: string) => {
  for (let shard = 0; shard < CARD_USAGE_TOTAL_SHARDS; shard += 1) {
    const usageShard = await getCardUsageShard(ctx, userId, shard);
    if (usageShard) {
      await ctx.db.delete("userCardUsageShards", usageShard._id);
    }
  }
  const usage = await getCardUsage(ctx, userId);
  if (usage) {
    await ctx.db.delete("userCardUsage", usage._id);
  }
};
