import { ConvexError } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import { api } from "../../_generated/api";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  FREE_TIER_LIMIT,
} from "@teak/shared/constants";

/**
 * Ensures the current user can create a new card. Throws a ConvexError when the
 * free tier quota is exhausted and the user is not premium.
 */
export async function ensureCardCreationAllowed(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const existingCards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined),
    )
    .collect();

  if (existingCards.length < FREE_TIER_LIMIT) {
    return;
  }

  const hasPremium = await ctx.runQuery(api.polar.userHasPremium);
  if (hasPremium) {
    return;
  }

  throw new ConvexError({
    code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
    message: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
  });
}
