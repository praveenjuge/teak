import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Sentry, logger, captureException } from "../sentry";

export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return Sentry.startSpan(
      {
        op: "ai.manualGenerate",
        name: `Manual AI Generation: ${cardId}`,
      },
      async (span) => {
        span.setAttribute("cardId", cardId);

        try {
          const user = await ctx.auth.getUserIdentity();
          if (!user) {
            const error = new Error("Authentication required");
            captureException(error, { cardId });
            throw error;
          }

          span.setAttribute("userId", user.subject);

          const verification = await ctx.runQuery(
            internal.ai.queries.getCardForVerification,
            {
              cardId,
              userId: user.subject,
            },
          );

          if (!verification) {
            const error = new Error("Card not found or access denied");
            captureException(error, { cardId, userId: user.subject });
            throw error;
          }

          await ctx.scheduler.runAfter(
            0,
            (internal as any)["workflows/manager"].startCardProcessingWorkflow,
            { cardId },
          );

          logger.info(logger.fmt`Manual AI generation triggered for card ${cardId}`, {
            userId: user.subject,
          });

          return { success: true };
        } catch (error) {
          captureException(error, { cardId, operation: "manuallyGenerateAI" });
          throw error;
        }
      }
    );
  },
});
