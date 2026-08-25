"use node";

import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerImageAnalysisResult,
  isFilesWorkerConfigured,
} from "../../../storage/filesWorkerClient";
import { hasKnownTinyImageDimensions } from "../../imageAnalysis";

export const analyzeImage = internalAction({
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
    if (!isFilesWorkerConfigured()) {
      return {
        error: "files_worker_not_configured",
        generated: false,
        success: false,
      };
    }
    try {
      const outcome = await callFilesWorkerJson<FilesWorkerImageAnalysisResult>(
        {
          op: "analyze-image",
          params: { sourceKey: card.fileKey },
        }
      );
      if (outcome.kind !== "ok") {
        return {
          error: "files_worker_image_analysis_unavailable",
          generated: false,
          success: false,
        };
      }
      await ctx.runMutation(
        internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
        {
          cardId,
          height: outcome.data.height,
          width: outcome.data.width,
        }
      );
      if (
        outcome.data.palette.length > 0 &&
        !hasKnownTinyImageDimensions(outcome.data)
      ) {
        await ctx.runMutation(
          internal.workflows.aiMetadata.mutations.updateCardColors,
          {
            cardId,
            colors: outcome.data.palette.map((hex) => ({ hex })),
          }
        );
      }
      return { generated: false, success: true };
    } catch {
      return {
        error: "files_worker_image_analysis_failed",
        generated: false,
        success: false,
      };
    }
  },
});
