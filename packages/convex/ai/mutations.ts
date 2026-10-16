import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  mergeProcessingStages,
  type ProcessingStatus,
} from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { cardTypeValidator, processingStatusObjectValidator } from "../schema";

export const updateCardProcessing = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingStatus: processingStatusObjectValidator,
    type: v.optional(cardTypeValidator),
    metadataStatus: v.optional(
      v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
    ),
    metadata: v.optional(v.any()),
    /** Only write the stages that are still in progress. */
    onlyIfInProgress: v.optional(v.boolean()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { cardId, type, metadataStatus, metadata, onlyIfInProgress } = args;
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    const processingStatus = onlyIfInProgress
      ? (Object.fromEntries(
          Object.entries(args.processingStatus).filter(
            ([stage]) =>
              card.processingStatus?.[stage as keyof ProcessingStatus]
                ?.status === "in_progress"
          )
        ) as typeof args.processingStatus)
      : args.processingStatus;
    if (onlyIfInProgress && Object.keys(processingStatus).length === 0) {
      return false;
    }
    await patchCardWithSearchSync(ctx, cardId, {
      ...(type ? { type } : {}),
      processingStatus: mergeProcessingStages(
        card.processingStatus,
        processingStatus
      ),
      ...(metadataStatus ? { metadataStatus } : {}),
      ...(metadata === undefined ? {} : { metadata }),
      updatedAt: Date.now(),
    });
    return true;
  },
});
