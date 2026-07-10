"use node";

import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { inferFileFormat } from "../../../shared/fileFormats";
import { resolveObjectUrl } from "../../../storage/r2";
import { buildFilePreviewFacts } from "../../fileProcessing";

export const generateFilePreview = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.object({
    generated: v.boolean(),
    success: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (!(card?.fileKey && card.fileMetadata?.fileName)) {
      return { generated: false, success: true };
    }

    const format = inferFileFormat({
      fileName: card.fileMetadata.fileName,
      mimeType: card.fileMetadata.mimeType,
    });
    if (!format) {
      return { generated: false, success: true };
    }

    const fileUrl = await resolveObjectUrl(card.fileKey);
    if (!fileUrl) {
      return { generated: false, success: true };
    }

    try {
      const preview = await buildFilePreviewFacts(fileUrl, format);
      if (!preview) {
        return { generated: false, success: true };
      }
      await ctx.runMutation(
        internal.workflows.steps.renderables.mutations.updateCardFilePreview,
        { cardId, preview }
      );
      return { generated: true, success: true };
    } catch {
      return { generated: false, success: true };
    }
  },
});
