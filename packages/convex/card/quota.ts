import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { assertAccountNotDeleting } from "../accountDeletion";
import { polar } from "../billing";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "../shared/constants";
import { isApprovedActiveSubscription } from "../shared/polarPlans";
import { rateLimiter } from "../shared/rateLimits";
import { ensureCardUsageShards, getCardUsageSnapshot } from "./cardUsage";

export interface CardQuotaDeps {
  getSubscription: (
    ctx: MutationCtx,
    args: { userId: string }
  ) => Promise<{ productId?: string; status?: string } | null | undefined>;
}

interface CardCreationDeps extends CardQuotaDeps {
  rateLimiter: Pick<typeof rateLimiter, "limit">;
}

const defaultQuotaDeps: CardQuotaDeps = {
  getSubscription: (ctx, args) => polar.getCurrentSubscription(ctx, args),
};

const defaultCardCreationDeps: CardCreationDeps = {
  ...defaultQuotaDeps,
  rateLimiter,
};

const consumeCardCreationLimit = async (
  ctx: MutationCtx,
  userId: string,
  limiter: CardCreationDeps["rateLimiter"]
) => {
  const rateLimitResult = await limiter.limit(ctx, "cardCreation", {
    key: userId,
    throws: false,
  });
  if (!rateLimitResult.ok) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.RATE_LIMITED,
      message: CARD_ERROR_MESSAGES.RATE_LIMITED,
      retryAt: Date.now() + rateLimitResult.retryAfter,
    });
  }
};

export const ensureCardQuotaAvailable = async (
  ctx: MutationCtx,
  userId: string,
  deps: CardQuotaDeps = defaultQuotaDeps
): Promise<void> => {
  const hasPremium = await getCardQuotaEntitlement(ctx, userId, deps);
  if (hasPremium) {
    return;
  }

  const usage = await getCardUsageSnapshot(ctx, userId);
  if (!usage) {
    return;
  }
  const isAtLimit = usage.isCountExact
    ? usage.activeCardCount >= FREE_TIER_LIMIT
    : (
        await ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (query) =>
            query.eq("userId", userId).eq("isDeleted", undefined)
          )
          .take(FREE_TIER_LIMIT)
      ).length >= FREE_TIER_LIMIT;
  if (usage.isSaturated || isAtLimit) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
};

export const getCardQuotaEntitlement = async (
  ctx: MutationCtx,
  userId: string,
  deps: CardQuotaDeps = defaultQuotaDeps
) => {
  await assertAccountNotDeleting(ctx, userId);
  let hasPremium = false;
  try {
    hasPremium = isApprovedActiveSubscription(
      await deps.getSubscription(ctx, { userId })
    );
  } catch {
    hasPremium = false;
  }
  return hasPremium;
};

export const authorizeCardCreation = async (
  ctx: MutationCtx,
  userId: string,
  deps: CardCreationDeps = defaultCardCreationDeps
) => {
  await consumeCardCreationLimit(ctx, userId, deps.rateLimiter);
  const hasPremium = await getCardQuotaEntitlement(ctx, userId, deps);
  await ensureCardUsageShards(ctx, userId, hasPremium);
  return { hasPremium };
};

export const ensureCardCreationAllowed = async (
  ctx: MutationCtx,
  userId: string,
  deps: CardCreationDeps = defaultCardCreationDeps
): Promise<void> => {
  await consumeCardCreationLimit(ctx, userId, deps.rateLimiter);
  await ensureCardQuotaAvailable(ctx, userId, deps);
};
