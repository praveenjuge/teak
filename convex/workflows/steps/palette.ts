"use node";

import { PhotonImage } from "@cf-wasm/photon";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

const MAX_COLORS = 5;
const SAMPLE_TARGET = 4000;
const CHANNEL_PRECISION = 16;
const MIN_DIMENSION = 12;

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
  if (!pixels.length) return [];

  const pixelCount = Math.floor(pixels.length / 4);
  if (!pixelCount) return [];

  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_TARGET));
  const colorCounts = new Map<string, number>();

  for (let i = 0; i < pixelCount; i += stride) {
    const offset = i * 4;
    const alpha = pixels[offset + 3];
    if (alpha < 16) continue;

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
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
      cardId,
    });

    if (!card || card.type !== "image" || !card.fileId) {
      return undefined;
    }

    // If palette already exists, skip recomputation
    if (Array.isArray(card.colors) && card.colors.length > 0) {
      return card.colors as any;
    }

    const fileUrl = await ctx.storage.getUrl(card.fileId);
    if (!fileUrl) {
      return undefined;
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image for palette: ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const image = PhotonImage.new_from_byteslice(bytes);

    try {
      const width = image.get_width();
      const height = image.get_height();

      if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
        return undefined;
      }

      const rawPixels = image.get_raw_pixels();
      const colors = computePalette(rawPixels, MAX_COLORS);

      if (!colors.length) {
        return undefined;
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
  },
});
