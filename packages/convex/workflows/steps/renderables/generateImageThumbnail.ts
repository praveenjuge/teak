"use node";

import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { generateImageViaFilesWorker } from "./workerPipeline";

export const generateImageThumbnail = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.object({
    error: v.optional(v.string()),
    generated: v.boolean(),
    success: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (!card?.fileKey || card.type !== "image") {
      return { generated: false, success: true };
    }
    const result = await generateImageViaFilesWorker(ctx, cardId, {
      fileKey: card.fileKey,
      userId: card.userId,
    });
    return result
      ? { generated: result.generated, success: true }
      : {
          error: "files_worker_image_processing_failed",
          generated: false,
          success: false,
        };
  },
});
