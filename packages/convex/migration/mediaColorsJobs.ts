"use node";

import type {
  FilesAnimationPaletteResult,
  FilesVideoFrameResult,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerImageAnalysisResult,
} from "../storage/filesWorkerClient";
import { runFilesWorkerRendering } from "../storage/filesWorkerRendering";
import { ensureObjectOwnership } from "../storage/ownership";
import { buildR2ObjectKey } from "../storage/r2";

// The colors jobs the media colors backfill (backfillMediaColors.ts) runs on
// existing cards. New cards get their colors from card processing in the
// Files Worker (apps/files-worker/src/workflows/cardProcessing).

const MIN_IMAGE_ANALYSIS_DIMENSION = 12;

const isTiny = (dimensions?: { height?: number; width?: number }) =>
  typeof dimensions?.width === "number" &&
  typeof dimensions.height === "number" &&
  (dimensions.width < MIN_IMAGE_ANALYSIS_DIMENSION ||
    dimensions.height < MIN_IMAGE_ANALYSIS_DIMENSION);

const resultValidator = v.object({
  error: v.optional(v.string()),
  success: v.boolean(),
});

/** Recolors an image card with the current palette. */
export const analyzeImageColors = internalAction({
  args: { cardId: v.id("cards") },
  returns: resultValidator,
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (!card?.fileKey || card.type !== "image") {
      return { success: true };
    }
    const outcome = await callFilesWorkerJson<FilesWorkerImageAnalysisResult>({
      op: "analyze-image",
      params: { sourceKey: card.fileKey },
    });
    if (outcome.kind !== "ok") {
      return {
        error: "files_worker_image_analysis_unavailable",
        success: false,
      };
    }
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
      {
        cardId,
        height: outcome.data.height,
        width: outcome.data.width,
        ...(outcome.data.exif ? { exif: outcome.data.exif } : {}),
      }
    );
    if (outcome.data.palette.length > 0 && !isTiny(outcome.data)) {
      await ctx.runMutation(
        internal.workflows.aiMetadata.mutations.updateCardColors,
        { cardId, colors: outcome.data.palette.map((hex) => ({ hex })) }
      );
    }
    return { success: true };
  },
});

/** Reads an animated GIF card's colors from frames across it. */
export const extractGifColors = internalAction({
  args: { cardId: v.id("cards") },
  returns: resultValidator,
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (
      card?.type !== "video" ||
      !card.fileKey ||
      (card.colors?.length ?? 0) > 0 ||
      isTiny(card.fileMetadata)
    ) {
      return { success: true };
    }
    const outcome = await runFilesWorkerRendering<FilesAnimationPaletteResult>(
      "extract-animation-palette",
      { sourceKey: card.fileKey }
    );
    if (outcome.kind === "ok" && outcome.data.palette.length > 0) {
      await ctx.runMutation(
        internal.workflows.aiMetadata.mutations.updateCardColors,
        { cardId, colors: outcome.data.palette.map((hex) => ({ hex })) }
      );
    }
    return { success: true };
  },
});

/**
 * Renders a video card's thumbnail and scrub sprite again, over its existing
 * keys, and stores the colors the frames give.
 */
export const rerenderVideoColors = internalAction({
  args: { cardId: v.id("cards") },
  returns: resultValidator,
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (card?.type !== "video" || !card.fileKey) {
      return { success: true };
    }
    const thumbnailKey =
      card.thumbnailKey ??
      buildR2ObjectKey({ userId: card.userId, cardId, role: "thumbnail" });
    const scrubKey =
      card.scrubKey ??
      buildR2ObjectKey({ userId: card.userId, cardId, role: "scrub" });
    await ensureObjectOwnership(ctx, card.userId, thumbnailKey);
    await ensureObjectOwnership(ctx, card.userId, scrubKey);
    const outcome = await runFilesWorkerRendering<FilesVideoFrameResult>(
      "extract-video-frame",
      {
        destinationKey: thumbnailKey,
        scrubDestinationKey: scrubKey,
        sourceKey: card.fileKey,
      }
    );
    if (outcome.kind === "declined") {
      return {
        error: `video_thumbnail_declined:${outcome.reason}`,
        success: false,
      };
    }
    const frame = outcome.data;
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardThumbnail,
      {
        cardId,
        thumbnailKey,
        ...(frame.originalWidth !== null && {
          originalWidth: frame.originalWidth,
        }),
        ...(frame.originalHeight !== null && {
          originalHeight: frame.originalHeight,
        }),
        ...(frame.scrub && { scrubKey, scrub: frame.scrub }),
      }
    );
    if (frame.palette?.length) {
      await ctx.runMutation(
        internal.workflows.aiMetadata.mutations.updateCardColors,
        { cardId, colors: frame.palette.map((hex) => ({ hex })) }
      );
    }
    return { success: true };
  },
});
