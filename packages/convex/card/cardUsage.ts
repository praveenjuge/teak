import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { FREE_TIER_LIMIT } from "../shared/constants";

export const CARD_USAGE_SCAN_LIMIT = FREE_TIER_LIMIT + 1;

type DatabaseReaderCtx = Pick<MutationCtx | QueryCtx, "db">;

export const getCardUsage = async (ctx: DatabaseReaderCtx, userId: string) =>
  await ctx.db
    .query("userCardUsage")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();

export const getOrInitializeCardUsage = async (
  ctx: MutationCtx,
  userId: string
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
  const activeCardCount = Math.min(activeCards.length, FREE_TIER_LIMIT);
  const id = await ctx.db.insert("userCardUsage", {
    userId,
    activeCardCount,
    isSaturated: activeCards.length >= FREE_TIER_LIMIT,
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
  userId: string
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  const nextCount = Math.min(usage.activeCardCount + 1, FREE_TIER_LIMIT);
  await ctx.db.patch("userCardUsage", usage._id, {
    activeCardCount: nextCount,
    isSaturated: usage.isSaturated || nextCount >= FREE_TIER_LIMIT,
    updatedAt: Date.now(),
  });
};

export const recordActiveCardRemoved = async (
  ctx: MutationCtx,
  userId: string
) => {
  const usage = await getOrInitializeCardUsage(ctx, userId);
  if (!usage.isSaturated) {
    await ctx.db.patch("userCardUsage", usage._id, {
      activeCardCount: Math.max(0, usage.activeCardCount - 1),
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
    activeCardCount: Math.min(remaining.length, FREE_TIER_LIMIT),
    isSaturated: remaining.length >= FREE_TIER_LIMIT,
    updatedAt: Date.now(),
  });
};

export const removeCardUsage = async (ctx: MutationCtx, userId: string) => {
  const usage = await getCardUsage(ctx, userId);
  if (usage) {
    await ctx.db.delete("userCardUsage", usage._id);
  }
};
