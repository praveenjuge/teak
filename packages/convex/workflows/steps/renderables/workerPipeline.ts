// Shared files-worker pipelines for renderable generation.
//
// Each helper mints short-lived signed op URLs, lets the worker do the heavy
// lifting over its R2 binding (decode/render/derive without bytes transiting
// Convex), persists the returned artifacts, and reports whether the caller
// reports whether the operation was handled.
"use node";

import { internal } from "../../../_generated/api";
import type { ActionCtx } from "../../../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerProcessImageResult,
  isFilesWorkerConfigured,
} from "../../../storage/filesWorkerClient";
import { buildR2ObjectKey } from "../../../storage/r2";
import { hasKnownTinyImageDimensions } from "../../imageAnalysis";

export interface WorkerPipelineResult {
  generated: boolean;
  /** False means the worker could not handle the source. */
  handled: boolean;
  thumbnailKey?: string;
}

const persistImageResult = async (
  ctx: ActionCtx,
  cardId: string,
  data: FilesWorkerProcessImageResult
): Promise<void> => {
  const { width, height } = data;

  await ctx.runMutation(
    internal.workflows.steps.renderables.mutations
      .updateCardProcessingProvenance,
    { cardId, provenance: data.provenance }
  );

  if (data.thumbnailGenerated && data.thumbnailKey) {
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardThumbnail,
      {
        cardId,
        thumbnailKey: data.thumbnailKey,
        originalWidth: width,
        originalHeight: height,
        ...(data.previewGenerated &&
          data.previewKey && { previewKey: data.previewKey }),
        ...(data.thumbhash && { placeholderHash: data.thumbhash }),
        ...(data.exif && { exif: data.exif }),
      }
    );
  } else {
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
      { cardId, width, height }
    );
    // Derivatives may still exist even when the thumbnail was skipped.
    if ((data.previewGenerated && data.previewKey) || data.thumbhash) {
      await ctx.runMutation(
        internal.workflows.steps.renderables.mutations
          .updateCardRenderableExtras,
        {
          cardId,
          ...(data.previewGenerated &&
            data.previewKey && { previewKey: data.previewKey }),
          ...(data.thumbhash && { placeholderHash: data.thumbhash }),
          ...(data.exif && { exif: data.exif }),
        }
      );
    }
  }

  // The worker decodes once and returns renderable + palette; store colors so
  // the palette step's early-return kicks in downstream.
  if (
    Array.isArray(data.palette) &&
    data.palette.length > 0 &&
    !hasKnownTinyImageDimensions({ width, height })
  ) {
    await ctx.runMutation(
      internal.workflows.aiMetadata.mutations.updateCardColors,
      {
        cardId,
        colors: data.palette.map((hex) => ({ hex })),
      }
    );
  }
};

/**
 * Fast path for raster/HEIC/SVG images: one signed process-image call yields
 * the thumbnail (+ preview derivative, palette, thumbhash, EXIF). Returns null
 * when the worker is unconfigured or declines the source.
 */
export const generateImageViaFilesWorker = async (
  ctx: ActionCtx,
  cardId: string,
  card: { userId: string; fileKey: string }
): Promise<WorkerPipelineResult | null> => {
  if (!isFilesWorkerConfigured()) {
    return null;
  }

  const destKey = buildR2ObjectKey({
    userId: card.userId,
    cardId,
    role: "thumbnail",
  });
  const previewKey = buildR2ObjectKey({
    userId: card.userId,
    cardId,
    role: "preview",
  });

  try {
    const outcome = await callFilesWorkerJson<FilesWorkerProcessImageResult>({
      op: "process-image",
      params: {
        destinationKey: destKey,
        previewDestinationKey: previewKey,
        sourceKey: card.fileKey,
      },
    });
    if (outcome.kind === "fallback") {
      return null;
    }
    await persistImageResult(ctx, cardId, outcome.data);
    return {
      handled: true,
      generated: outcome.data.thumbnailGenerated,
      thumbnailKey: outcome.data.thumbnailKey ?? undefined,
    };
  } catch {
    return null;
  }
};
