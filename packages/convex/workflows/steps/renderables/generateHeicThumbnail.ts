"use node";

import { v } from "convex/values";
import convert from "heic-convert";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import type { Id } from "../../../shared/types";
import {
  buildR2ObjectKey,
  resolveObjectUrl,
  storeObject,
} from "../../../storage/r2";
import { fetchBoundedBytes } from "../../fileProcessing";
import { generateImageViaFilesWorker } from "./workerPipeline";

const MAX_HEIC_PREVIEW_BYTES = 25 * 1024 * 1024;

export const copyToExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const generateHeicThumbnail = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.object({
    generated: v.boolean(),
    success: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });
    if (!card?.fileKey) {
      return { generated: false, success: true };
    }

    // Preferred path: decode on the files worker over its R2 binding (also
    // yields palette/thumbhash/EXIF in the same pass).
    try {
      const workerResult = await generateImageViaFilesWorker(ctx, cardId, {
        userId: card.userId,
        fileKey: card.fileKey,
      });
      if (workerResult) {
        return { generated: workerResult.generated, success: true };
      }
    } catch {
      // Transient worker failure → legacy conversion below keeps this
      // best-effort instead of failing the workflow step.
    }

    try {
      const fileUrl = await resolveObjectUrl(card.fileKey);
      const bytes = fileUrl
        ? await fetchBoundedBytes(fileUrl, MAX_HEIC_PREVIEW_BYTES)
        : null;
      if (!bytes) {
        return { generated: false, success: true };
      }

      const converted = await convert({
        buffer: Buffer.from(bytes),
        format: "JPEG",
        quality: 0.82,
      });
      const jpegBytes = Uint8Array.from(converted);
      const jpegBuffer = copyToExactArrayBuffer(jpegBytes);
      const thumbnailKey = buildR2ObjectKey({
        cardId,
        fileName: "heic-preview.jpg",
        role: "thumbnail",
        userId: card.userId,
      });
      await storeObject(ctx, new Blob([jpegBuffer]), {
        key: thumbnailKey,
        type: "image/jpeg",
      });
      await ctx.runMutation(
        internal.workflows.steps.renderables.mutations.updateCardThumbnail,
        { cardId: cardId as Id<"cards">, thumbnailKey }
      );
      return { generated: true, success: true };
    } catch {
      return { generated: false, success: true };
    }
  },
});
