import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentAuthUser, requireCurrentUserId } from "./authHelpers";
import { polar } from "./billing";
import { captureBackendEvent } from "./posthog";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "./shared/constants";
import { rateLimiter } from "./shared/rateLimits";

// Get the current user
export const getCurrentUserHandler = async (ctx: any) => {
  const user = await getCurrentAuthUser(ctx);
  if (!user) return null;

  const userId = user.userId;

  let hasPremium = false;
  try {
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId,
    });
    hasPremium = subscription?.status === "active";
  } catch {
    hasPremium = false;
  }

  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    )
    .collect();
  const cardCount = cards.length;
  const canCreateCard = hasPremium || cardCount < FREE_TIER_LIMIT;

  return {
    ...user.identity,
    id: userId,
    subject: userId,
    email: user.email ?? undefined,
    name: user.name,
    hasPremium,
    cardCount,
    canCreateCard,
  };
};

export const getCurrentUser = query({
  args: {},
  handler: getCurrentUserHandler,
});

/**
 * Ensures the current user can create a new card.
 * Checks both rate limits (30 cards/minute) and card count limits (free tier).
 * Throws a ConvexError with appropriate code when limits are exceeded.
 */
type CardCreationDeps = {
  rateLimiter: Pick<typeof rateLimiter, "limit">;
  getSubscription: (
    ctx: MutationCtx,
    args: { userId: string }
  ) => Promise<{ status?: string } | null | undefined>;
};

const defaultCardCreationDeps: CardCreationDeps = {
  rateLimiter,
  getSubscription: (ctx, args) => polar.getCurrentSubscription(ctx, args),
};

export async function ensureCardCreationAllowed(
  ctx: MutationCtx,
  userId: string,
  deps: CardCreationDeps = defaultCardCreationDeps
): Promise<void> {
  // Check rate limit first (fast fail for abuse prevention)
  const rateLimitResult = await deps.rateLimiter.limit(ctx, "cardCreation", {
    key: userId,
    throws: false,
  });

  if (!rateLimitResult.ok) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.RATE_LIMITED,
      message: CARD_ERROR_MESSAGES.RATE_LIMITED,
    });
  }

  let hasPremium = false;
  try {
    const subscription = await deps.getSubscription(ctx, { userId });
    hasPremium = subscription?.status === "active";
  } catch {
    hasPremium = false;
  }

  if (hasPremium) {
    return;
  }

  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    )
    .collect();

  if (cards.length >= FREE_TIER_LIMIT) {
    throw new ConvexError({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
    });
  }
}

export const deleteAccountHandler = async (ctx: any) => {
  const userId = await requireCurrentUserId(ctx);
  let deletedStorageObjectCount = 0;

  // Use by_user_deleted index with partial match (just userId)
  // This works because Convex allows querying on prefix of compound indexes
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) => q.eq("userId", userId))
    .collect();

  for (const card of cards) {
    if (card.fileId) {
      await ctx.storage.delete(card.fileId);
      deletedStorageObjectCount += 1;
    }
    if (card.thumbnailId) {
      await ctx.storage.delete(card.thumbnailId);
      deletedStorageObjectCount += 1;
    }

    await ctx.db.delete("cards", card._id);
  }

  await captureBackendEvent(ctx, {
    event: "backend_account_deleted",
    distinctId: userId,
    properties: {
      deleted_cards_count: cards.length,
      deleted_storage_object_count: deletedStorageObjectCount,
    },
  });

  return { deletedCards: cards.length };
};

export const deleteAccount = mutation({
  args: {},
  handler: deleteAccountHandler,
});
