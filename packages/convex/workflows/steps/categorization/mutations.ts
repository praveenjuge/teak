/**
 * Categorization Mutations
 *
 * Database mutations for updating categorization results.
 * Separated from index.ts because mutations can't use "use node".
 */

import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalMutation } from "../../../_generated/server";
import {
  mergeProcessingStages,
  stageCompleted,
} from "../../../card/processingStatus";
import { patchCardWithSearchSync } from "../../../card/searchDocumentHelpers";
import { r2KeyValidator } from "../../../schema";
import { rateLimiter } from "../../../shared/rateLimits";
import { serializeArchivableRaw } from "../../../storage/rawMetadata";

export const updateCategorization = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadata: v.any(),
    /**
     * A site's image (a Wikipedia lead image, an Open Library cover) the
     * Worker stored for a link whose page had none. It never replaces one.
     */
    previewImage: v.optional(
      v.object({
        imageHeight: v.number(),
        imageStorageKey: r2KeyValidator,
        imageUpdatedAt: v.number(),
        imageWidth: v.number(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, metadata, previewImage }) => {
    const now = Date.now();

    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return null;
    }

    const updatedProcessing = mergeProcessingStages(card.processingStatus, {
      categorize: stageCompleted(now, metadata.confidence),
    });

    const preview = card.metadata?.linkPreview;
    const updatedMetadata = {
      ...(card.metadata || {}),
      linkCategory: metadata,
      ...(previewImage &&
      preview?.status === "success" &&
      !preview.imageStorageKey
        ? { linkPreview: { ...preview, ...previewImage } }
        : {}),
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

/**
 * One of arXiv's API slots for the Files Worker's categorization step: at
 * most one request every 3 seconds for the whole deployment. `retryAfter`
 * is how long to wait before the request (the slot is reserved); null means
 * the queue is full and the lookup is skipped.
 */
export const takeArxivSlot = internalMutation({
  args: {},
  returns: v.union(v.null(), v.object({ retryAfter: v.number() })),
  handler: async (ctx) => {
    const status = await rateLimiter.limit(ctx, "arxivApi", { reserve: true });
    return status.ok ? { retryAfter: status.retryAfter ?? 0 } : null;
  },
});
