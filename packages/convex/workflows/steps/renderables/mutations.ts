import { FILES_WAVEFORM_BARS } from "@teak/files-protocol";
import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import {
  mergeProcessingStages,
  stageFailed,
} from "../../../card/processingStatus";
import { patchCardWithSearchSync } from "../../../card/searchSync";
import { filePreviewFactsValidator, imageExifValidator } from "../../../schema";
import { queueCardProcessingFailed } from "../../../telemetry/schedule";

export const markCardRenderablesFailed = internalMutation({
  args: { cardId: v.id("cards"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }
    const now = Date.now();
    await patchCardWithSearchSync(ctx, args.cardId, {
      processingStatus: mergeProcessingStages(card.processingStatus, {
        renderables: stageFailed(
          now,
          args.error,
          card.processingStatus?.renderables
        ),
      }),
      updatedAt: now,
    });
    await queueCardProcessingFailed(ctx, {
      cardType: card.type,
      errorClass: args.error,
      stage: "renderables",
      userId: card.userId,
    });
    return null;
  },
});

export const updateCardFileMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    width: v.number(),
    height: v.number(),
    exif: v.optional(imageExifValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await patchCardWithSearchSync(ctx, args.cardId, {
      fileMetadata: {
        ...(card.fileMetadata || {}),
        width: args.width,
        height: args.height,
        ...(args.exif ? { exif: args.exif } : {}),
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

const waveformValidator = v.object({
  grid: v.array(v.number()),
  detail: v.array(v.number()),
});

const isWaveformBars = (values: number[], count: number) =>
  values.length === count &&
  values.every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 100
  );

export const updateCardMediaFacts = internalMutation({
  args: {
    cardId: v.id("cards"),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    waveform: v.optional(waveformValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      args.waveform &&
      !(
        isWaveformBars(args.waveform.grid, FILES_WAVEFORM_BARS.grid) &&
        isWaveformBars(args.waveform.detail, FILES_WAVEFORM_BARS.detail)
      )
    ) {
      throw new Error("invalid_waveform");
    }
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }
    const current = card.fileMetadata || {};
    const missing = {
      ...(args.waveform &&
        current.waveform === undefined && { waveform: args.waveform }),
      ...(args.duration !== undefined &&
        current.duration === undefined && { duration: args.duration }),
      ...(args.width !== undefined &&
        current.width === undefined && { width: args.width }),
      ...(args.height !== undefined &&
        current.height === undefined && { height: args.height }),
    };
    if (Object.keys(missing).length === 0) {
      return null;
    }
    await patchCardWithSearchSync(ctx, args.cardId, {
      fileMetadata: { ...current, ...missing },
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateCardFilePreview = internalMutation({
  args: {
    cardId: v.id("cards"),
    preview: filePreviewFactsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await patchCardWithSearchSync(ctx, args.cardId, {
      fileMetadata: {
        ...(card.fileMetadata || {}),
        preview: {
          ...(card.fileMetadata?.preview || {}),
          ...args.preview,
        },
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateCardThumbnail = internalMutation({
  args: {
    cardId: v.id("cards"),
    thumbnailKey: v.string(),
    originalWidth: v.optional(v.number()),
    originalHeight: v.optional(v.number()),
    scrubKey: v.optional(v.string()),
    scrub: v.optional(
      v.object({
        frames: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
      })
    ),
    duration: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    if ((args.scrubKey === undefined) !== (args.scrub === undefined)) {
      throw new Error("scrub_key_and_size_go_together");
    }
    const updates: {
      thumbnailKey: string;
      scrubKey?: string;
      updatedAt: number;
      fileMetadata?: NonNullable<typeof card.fileMetadata>;
    } = {
      thumbnailKey: args.thumbnailKey,
      ...(args.scrubKey !== undefined && { scrubKey: args.scrubKey }),
      updatedAt: Date.now(),
    };

    const hasFacts =
      args.originalWidth !== undefined ||
      args.originalHeight !== undefined ||
      args.scrub !== undefined ||
      (args.duration !== undefined &&
        card.fileMetadata?.duration === undefined);
    if (hasFacts) {
      updates.fileMetadata = {
        ...(card.fileMetadata || {}),
        ...(args.originalWidth !== undefined && { width: args.originalWidth }),
        ...(args.originalHeight !== undefined && {
          height: args.originalHeight,
        }),
        ...(args.scrub !== undefined && { scrub: args.scrub }),
        ...(args.duration !== undefined &&
          card.fileMetadata?.duration === undefined && {
            duration: args.duration,
          }),
      };
    }

    await patchCardWithSearchSync(ctx, args.cardId, updates);
    return null;
  },
});
