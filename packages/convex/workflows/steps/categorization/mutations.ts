import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalMutation } from "../../../_generated/server";
import { patchCard } from "../../../card/cardWrites";
import { rateLimiter } from "../../../rateLimiter";
import { r2KeyValidator } from "../../../schema/validators/cards";
import {
  mergeProcessingStages,
  stageCompleted,
} from "../../../shared/processingStatus";
import { queueObjectDeletion } from "../../../storage/objectDeletion";
import {
  assertArchivedRawReference,
  serializeArchivableRaw,
} from "../../../storage/rawMetadata";

export const updateCategorization = internalMutation({
  args: {
    cardId: v.id("cards"),
    metadata: v.any(),
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

    assertArchivedRawReference(card, "linkCategory", metadata);
    const committed = await patchCard(ctx, cardId, {
      metadata: updatedMetadata,
      processingStatus: updatedProcessing,
      updatedAt: now,
    });
    const archivedRawKey: string | undefined = metadata.rawStorageKey;
    if (
      !committed &&
      archivedRawKey &&
      archivedRawKey !== card.metadata?.linkCategory?.rawStorageKey
    ) {
      await queueObjectDeletion(ctx, archivedRawKey);
    }

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

// arXiv allows one API request every 3 seconds from the whole deployment.
export const takeArxivSlot = internalMutation({
  args: {},
  returns: v.union(v.null(), v.object({ retryAfter: v.number() })),
  handler: async (ctx) => {
    const status = await rateLimiter.limit(ctx, "arxivApi", { reserve: true });
    return status.ok ? { retryAfter: status.retryAfter ?? 0 } : null;
  },
});
