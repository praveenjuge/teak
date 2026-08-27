import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { CARD_ERROR_CODES, CARD_ERROR_MESSAGES } from "../shared/constants";

export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Authentication required");
    }

    const verification = await ctx.runQuery(
      internal.ai.queries.getCardForVerification,
      {
        cardId,
        userId: user.subject,
      }
    );

    if (!verification) {
      throw new Error("Card not found or access denied");
    }

    const allowed = await ctx.runMutation(
      internal.card.updateCard.consumeCardReprocessLimitForUser,
      { cardId, userId: user.subject }
    );
    if (!allowed) {
      throw new ConvexError({
        code: CARD_ERROR_CODES.RATE_LIMITED,
        message: CARD_ERROR_MESSAGES.RATE_LIMITED,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId }
    );

    return { success: true };
  },
});
