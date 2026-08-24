"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import {
  callFilesWorkerJson,
  type FilesWorkerProcessImageResult,
} from "../../storage/filesWorkerClient";
import { withBackendSpan } from "../../telemetry/sentry";
import { hasKnownTinyImageDimensions } from "../imageAnalysis";

export const extractPaletteFromImage = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, { cardId }) =>
    withBackendSpan(
      {
        cardId,
        name: "card.palette",
        operation: TELEMETRY_OPERATIONS.storageRender,
        stage: "palette",
        surface: "backend",
      },
      async () => {
        const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
          cardId,
        });

        if (card?.type !== "image" || !card.fileKey) {
          return;
        }

        // If palette already exists, skip recomputation
        if (Array.isArray(card.colors) && card.colors.length > 0) {
          return card.colors as any;
        }

        // For SVG files, use the generated thumbnail (rasterized PNG) for palette extraction
        // Photon can only process raster images, not SVG
        const isSvg =
          card.fileMetadata?.mimeType === "image/svg+xml" ||
          card.fileMetadata?.fileName?.endsWith(".svg") ||
          card.fileMetadata?.fileName?.endsWith(".SVG");

        const width = card.fileMetadata?.width;
        const height = card.fileMetadata?.height;
        const originalIsBounded =
          typeof width === "number" &&
          typeof height === "number" &&
          width > 0 &&
          height > 0 &&
          width <= 500 &&
          height <= 500;

        if (hasKnownTinyImageDimensions(card.fileMetadata)) {
          return;
        }

        // Prefer the bounded thumbnail for every image. Only decode the
        // original when thumbnailing intentionally skipped an already-small
        // raster image.
        const fileKeyForPalette =
          card.thumbnailKey ??
          (!isSvg && originalIsBounded ? card.fileKey : null);

        if (!fileKeyForPalette) {
          return;
        }

        try {
          const outcome =
            await callFilesWorkerJson<FilesWorkerProcessImageResult>({
              op: "process-image",
              params: { sourceKey: fileKeyForPalette },
            });
          if (outcome.kind !== "ok") {
            return;
          }
          const {
            width: processedWidth,
            height: processedHeight,
            palette,
          } = outcome.data;
          if (
            !Array.isArray(palette) ||
            palette.length === 0 ||
            hasKnownTinyImageDimensions({
              height: processedHeight,
              width: processedWidth,
            })
          ) {
            return;
          }
          const colors = palette.map((hex) => ({ hex }));
          await ctx.runMutation(
            internal.workflows.aiMetadata.mutations.updateCardColors,
            { cardId, colors }
          );
          return colors as any;
        } catch {}
      }
    ),
});
