import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSessionUser } from "../securitySessions";

/**
 * Re-runs the full processing pipeline for a card. Kept for older clients;
 * new code calls the `cards.reprocessCard` mutation, which this delegates to.
 */
export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    await ctx.runMutation(internal.card.updateCard.reprocessCardForUser, {
      cardId,
      userId: user.teakUserId,
    });

    return { success: true };
  },
});
