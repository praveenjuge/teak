"use node";

import type { FilesVideoFrameResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  type FilesWorkerRenderingOutcome,
  runFilesWorkerRendering,
} from "../../../storage/filesWorkerRendering";
import { ensureObjectOwnership } from "../../../storage/ownership";
import { buildR2ObjectKey } from "../../../storage/r2";

const roundedSeconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000) / 1000
    : undefined;

/**
 * Generate a video card's thumbnail and hover scrub sprite on the Files
 * Worker's media renderer, which reads the video from R2 and writes both
 * images there. A source the renderer cannot decode fails without a retry; a
 * busy or unavailable renderer is retryable. A card that already has a
 * thumbnail is skipped unless `rerender` is set; then the renderer writes over
 * the existing thumbnail and scrub keys (the colors backfill uses this).
 */
export const generateVideoThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
    rerender: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailKey: v.optional(v.string()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
      cardId: args.cardId,
    });
    if (!card) {
      return {
        success: false,
        generated: false,
        error: "card_not_found",
        retryable: false,
      };
    }
    if (card.type !== "video" || !card.fileKey) {
      return { success: true, generated: false };
    }
    if (card.thumbnailKey && !args.rerender) {
      return {
        success: true,
        generated: false,
        thumbnailKey: card.thumbnailKey,
      };
    }

    // Both keys are registered before anything writes them.
    const thumbnailKey =
      card.thumbnailKey ??
      buildR2ObjectKey({
        userId: card.userId,
        cardId: args.cardId,
        role: "thumbnail",
      });
    const scrubKey =
      card.scrubKey ??
      buildR2ObjectKey({
        userId: card.userId,
        cardId: args.cardId,
        role: "scrub",
      });
    await ensureObjectOwnership(ctx, card.userId, thumbnailKey);
    await ensureObjectOwnership(ctx, card.userId, scrubKey);

    let outcome: FilesWorkerRenderingOutcome<FilesVideoFrameResult>;
    try {
      outcome = await runFilesWorkerRendering<FilesVideoFrameResult>(
        "extract-video-frame",
        {
          destinationKey: thumbnailKey,
          scrubDestinationKey: scrubKey,
          sourceKey: card.fileKey,
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[renderables/video] Frame extraction failed for card ${args.cardId}`,
        { error: message }
      );
      return {
        success: false,
        generated: false,
        error: message,
        retryable: true,
      };
    }
    if (outcome.kind === "declined") {
      console.log(
        `[renderables/video] Renderer declined card ${args.cardId}: ${outcome.reason}`
      );
      return {
        success: false,
        generated: false,
        error: `video_thumbnail_declined:${outcome.reason}`,
        retryable: false,
      };
    }

    const frame = outcome.data;
    const duration = roundedSeconds(
      frame.durationSeconds ?? frame.facts?.durationSeconds
    );
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardThumbnail,
      {
        cardId: args.cardId,
        thumbnailKey,
        ...(frame.originalWidth !== null && {
          originalWidth: frame.originalWidth,
        }),
        ...(frame.originalHeight !== null && {
          originalHeight: frame.originalHeight,
        }),
        ...(frame.scrub && { scrubKey, scrub: frame.scrub }),
        ...(duration !== undefined && { duration }),
      }
    );
    // Colors from the thumbnail and scrub frames, when the renderer sent them.
    if (frame.palette?.length) {
      await ctx.runMutation(
        internal.workflows.aiMetadata.mutations.updateCardColors,
        { cardId: args.cardId, colors: frame.palette.map((hex) => ({ hex })) }
      );
    }
    return { success: true, generated: true, thumbnailKey };
  },
});

/**
 * Manual trigger for video thumbnail generation (useful for testing)
 */
export const manualTriggerVideoThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      await ctx.runAction(
        internal.workflows.steps.renderables.generateVideoThumbnail
          .generateVideoThumbnail,
        {
          cardId: args.cardId,
        }
      );
      return {
        success: true,
        message: `Video thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate video thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
