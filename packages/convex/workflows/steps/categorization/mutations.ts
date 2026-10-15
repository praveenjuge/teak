/**
 * Categorization Mutations
 *
 * Database mutations for updating categorization results.
 * Separated from index.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalMutation } from "../../../_generated/server";
import { stageCompleted } from "../../../card/processingStatus";
import { patchCardWithSearchSync } from "../../../card/searchDocumentHelpers";
import { serializeArchivableRaw } from "../../../storage/rawMetadata";

export const updateCategorization = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadata: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, metadata }) => {
    const now = Date.now();

    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }

    const processingStatus = card.processingStatus || {};
    const updatedProcessing = {
      ...processingStatus,
      categorize: stageCompleted(now, metadata.confidence),
    };

    const updatedMetadata = {
      ...(card.metadata || {}),
      linkCategory: metadata,
    };

    await patchCardWithSearchSync(ctx, cardId, {
      metadata: updatedMetadata,
      processingStatus: updatedProcessing,
      updatedAt: now,
    });

    if (serializeArchivableRaw(metadata.raw) !== null) {
      await ctx.scheduler.runAfter(
        0,
        internal.storage.rawMetadataMaintenance.archiveCard,
        { cardId }
      );
    }
    return null;
  },
});
