import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { FREE_TIER_LIMIT } from "../shared/constants";

export const CARD_USAGE_SCAN_LIMIT = FREE_TIER_LIMIT + 1;

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

export const recordActiveCardCreated = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  const nextCount = usage.activeCardCount + 1;
  const migrationEntry = await getCardUsageMigrationEntry(ctx, cardId);
  let migrationActiveCardCount = usage.migrationActiveCardCount;
  if (migrationActiveCardCount !== undefined) {
    if (migrationEntry) {
      if (!migrationEntry.countedActive) {
        await ctx.db.patch("cardUsageMigrationEntries", migrationEntry._id, {
          countedActive: true,
        });
        migrationActiveCardCount += 1;
      }
    } else {
      await ctx.db.insert("cardUsageMigrationEntries", {
        cardId,
        userId,
        countedActive: true,
        createdAt: Date.now(),
      });
      migrationActiveCardCount += 1;
    }
  }
  await ctx.db.patch("userCardUsage", usage._id, {
    activeCardCount: nextCount,
    isCountExact: usage.isCountExact,
    isSaturated: usage.isSaturated || nextCount >= FREE_TIER_LIMIT,
    migrationActiveCardCount,
    migrationBackfilledAt: undefined,
    updatedAt: Date.now(),
  });
};

export const recordActiveCardRemoved = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  const migrationEntry = await getCardUsageMigrationEntry(ctx, cardId);
  let migrationActiveCardCount = usage.migrationActiveCardCount;
  if (migrationActiveCardCount !== undefined && migrationEntry?.countedActive) {
    await ctx.db.patch("cardUsageMigrationEntries", migrationEntry._id, {
      countedActive: false,
    });
    migrationActiveCardCount = Math.max(0, migrationActiveCardCount - 1);
  }
  if (usage.isCountExact ?? !usage.isSaturated) {
    const nextCount = Math.max(0, usage.activeCardCount - 1);
    await ctx.db.patch("userCardUsage", usage._id, {
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
  await ctx.db.patch("userCardUsage", usage._id, {
    activeCardCount: remaining.length,
    isCountExact: remaining.length < CARD_USAGE_SCAN_LIMIT,
    isSaturated: remaining.length >= FREE_TIER_LIMIT,
    migrationActiveCardCount,
    migrationBackfilledAt: undefined,
    updatedAt: Date.now(),
  });
};

export const removeCardUsage = async (ctx: MutationCtx, userId: string) => {
  const usage = await getCardUsage(ctx, userId);
  if (usage) {
    await ctx.db.delete("userCardUsage", usage._id);
  }
};
