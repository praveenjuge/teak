"use node";

import { PhotonImage } from "@cf-wasm/photon";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import { resolveObjectUrl } from "../../storage/r2";
import { withBackendSpan } from "../../telemetry/sentry";
import { hasKnownTinyImageDimensions } from "../imageAnalysis";

const MAX_COLORS = 5;
const SAMPLE_TARGET = 4000;
const CHANNEL_PRECISION = 16;

const quantizeChannel = (value: number): number => {
  const clamped = Math.max(0, Math.min(255, value));
  const bucket = Math.round(clamped / CHANNEL_PRECISION) * CHANNEL_PRECISION;
  return Math.max(0, Math.min(255, bucket));
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const computePalette = (pixels: Uint8Array, maxColors: number): string[] => {
  if (!pixels.length) {
    return [];
  }

  const pixelCount = Math.floor(pixels.length / 4);
  if (!pixelCount) {
    return [];
  }

  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_TARGET));
  const colorCounts = new Map<string, number>();

  for (let i = 0; i < pixelCount; i += stride) {
    const offset = i * 4;
    const alpha = pixels[offset + 3];
    if (alpha < 16) {
      continue;
    }

    const r = quantizeChannel(pixels[offset]);
    const g = quantizeChannel(pixels[offset + 1]);
    const b = quantizeChannel(pixels[offset + 2]);
    const hex = rgbToHex(r, g, b);
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  if (!colorCounts.size) {
    const [r = 0, g = 0, b = 0] = pixels;
    return [rgbToHex(r, g, b)];
  }

  return [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
};

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

        const fileUrl = await resolveObjectUrl(fileKeyForPalette);
        if (!fileUrl) {
          return;
        }

        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image for palette: ${response.status}`
          );
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        let image: PhotonImage;
        try {
          image = PhotonImage.new_from_byteslice(bytes);
        } catch {
          return;
        }

        try {
          const width = image.get_width();
          const height = image.get_height();

          if (hasKnownTinyImageDimensions({ height, width })) {
            return;
          }

          const rawPixels = image.get_raw_pixels();
          const colors = computePalette(rawPixels, MAX_COLORS);

          if (!colors.length) {
            return;
          }

          const palette = colors.map((hex) => ({ hex }));

          await ctx.runMutation(
            internal.workflows.aiMetadata.mutations.updateCardColors,
            {
              cardId,
              colors: palette,
            }
          );

          return palette as any;
        } finally {
          image.free();
        }
      }
    ),
});
