"use node";

import type { FilesAnimationPaletteResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  type FilesWorkerRenderingOutcome,
  runFilesWorkerRendering,
} from "../../../storage/filesWorkerRendering";
import { hasKnownTinyImageDimensions } from "../../imageAnalysis";

/**
 * Read an animated GIF card's colors from frames across it on the Files
 * Worker's media renderer. Colors are an enrichment: a GIF the renderer
 * declines keeps no colors and still succeeds; a busy or unavailable
 * renderer is retryable.
 */
export const extractAnimationPalette = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.object({
    error: v.optional(v.string()),
    generated: v.boolean(),
    retryable: v.optional(v.boolean()),
    success: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
      cardId,
    });
    if (
      card?.type !== "video" ||
      !card.fileKey ||
      (card.colors?.length ?? 0) > 0 ||
      hasKnownTinyImageDimensions(card.fileMetadata)
    ) {
      return { generated: false, success: true };
    }

    let outcome: FilesWorkerRenderingOutcome<FilesAnimationPaletteResult>;
    try {
      outcome = await runFilesWorkerRendering<FilesAnimationPaletteResult>(
        "extract-animation-palette",
        { sourceKey: card.fileKey }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[renderables/animation] Palette failed for card ${cardId}`,
        { error: message }
      );
      return {
        error: message,
        generated: false,
        retryable: true,
        success: false,
      };
    }
    if (outcome.kind === "declined") {
      console.log(
        `[renderables/animation] Renderer declined card ${cardId}: ${outcome.reason}`
      );
      return { generated: false, success: true };
    }
    if (outcome.data.palette.length > 0) {
      await ctx.runMutation(
        internal.workflows.aiMetadata.mutations.updateCardColors,
        { cardId, colors: outcome.data.palette.map((hex) => ({ hex })) }
      );
    }
    return { generated: false, success: true };
  },
});
