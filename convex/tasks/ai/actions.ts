import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Authentication required");
    }

    const verification = await ctx.runQuery(
      internal.tasks.ai.queries.getCardForVerification,
      {
        cardId,
        userId: user.subject,
      },
    );

    if (!verification) {
      throw new Error("Card not found or access denied");
    }

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId },
    );

    return { success: true };
  },
});
