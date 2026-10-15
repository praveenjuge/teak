import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSessionUser } from "../securitySessions";

/** @deprecated Older clients only; call the `cards.reprocessCard` mutation. */
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
