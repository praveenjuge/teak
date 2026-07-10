import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { type MutationCtx, mutation } from "../_generated/server";
import { ensureCardCreationAllowed } from "../auth";
import { type CardType, cardTypeValidator } from "../schema";
import { buildR2ObjectKey, buildR2UserPrefix, r2 } from "../storage/r2";
import {
  scheduleCardOutcome,
  scheduleUploadOutcome,
} from "../telemetry/schedule";
import {
  buildInitialProcessingStatus,
  stageCompleted,
} from "./processingStatus";

const FILE_CARD_TYPES: CardType[] = ["image", "video", "audio", "document"];

export const validateFileCardType = (cardType: CardType) => {
  if (!FILE_CARD_TYPES.includes(cardType)) {
    throw new ConvexError({
      code: "TYPE_MISMATCH",
      message:
        "File uploads must specify a file-based card type (image, video, audio, or document)",
    });
  }
};

export const mimeMatchesCardType = (
  mime: string | undefined,
  cardType: CardType
) => {
  if (!mime) {
    return true; // fall back to trusting the client when mime is missing
  }

  if (cardType === "image") {
    return mime.startsWith("image/");
  }
  if (cardType === "video") {
    return mime.startsWith("video/");
  }
  if (cardType === "audio") {
    return mime.startsWith("audio/");
  }

  if (cardType === "document") {
    return (
      mime === "application/pdf" ||
      mime.startsWith("application/msword") ||
      mime.startsWith("application/vnd.openxmlformats-officedocument") ||
      mime.startsWith("text/")
    );
  }

  return false;
};

// Unified upload mutation that handles the complete upload-to-card pipeline
export const uploadAndCreateCard = mutation({
  args: {
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    cardType: cardTypeValidator,
    content: v.optional(v.string()),
    additionalMetadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    cardId: v.optional(v.id("cards")),
    uploadKey: v.optional(v.string()),
    uploadUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, _args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    await scheduleUploadOutcome(ctx, {
      bytes: _args.fileSize,
      fileBucket: _args.cardType,
      outcome: "attempt",
      userId: user.subject,
    });

    try {
      // Check rate limit and card count limit
      await ensureCardCreationAllowed(ctx, user.subject);

      const upload = await r2.generateUploadUrl(
        buildR2ObjectKey({
          userId: user.subject,
          role: "file",
          fileName: _args.fileName,
        })
      );

      return {
        success: true,
        uploadKey: upload.key,
        uploadUrl: upload.url,
        cardId: undefined, // Will be set after successful upload
      };
    } catch (error) {
      await scheduleUploadOutcome(ctx, {
        bytes: _args.fileSize,
        fileBucket: _args.cardType,
        outcome: "failure",
        userId: user.subject,
      });
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data
      ) {
        const { code, message } = error.data as {
          code?: string;
          message?: string;
        };
        if (code) {
          return {
            success: false,
            errorCode: code,
            error: message,
          };
        }
      }
      console.error("Failed to prepare upload:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to prepare upload",
      };
    }
  },
});

export const createUploadedCardForUser = async (
  ctx: MutationCtx,
  args: {
    additionalMetadata?: any;
    cardType: CardType;
    content?: string;
    fileKey: string;
    fileName: string;
    fileSize?: number;
    fileType?: string;
    storedFileSize?: number;
    storedFileType?: string;
    notes?: string | null;
    tags?: string[];
    userId: string;
  }
) => {
  const now = Date.now();

  await ensureCardCreationAllowed(ctx, args.userId);
  validateFileCardType(args.cardType);

  if (!args.fileKey.startsWith(`${buildR2UserPrefix(args.userId)}/`)) {
    throw new ConvexError({
      code: "INVALID_STORAGE_KEY",
      message: "Uploaded file key does not belong to the current user",
    });
  }

  const fileType = args.fileType?.trim().toLowerCase();
  const storedFileType = args.storedFileType?.trim().toLowerCase();

  if (storedFileType && fileType && fileType !== storedFileType) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file type does not match the stored object",
    });
  }

  if (
    args.storedFileSize !== undefined &&
    args.fileSize !== undefined &&
    args.fileSize !== args.storedFileSize
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file size does not match the stored object",
    });
  }

  if (!mimeMatchesCardType(storedFileType ?? fileType, args.cardType)) {
    throw new ConvexError({
      code: "TYPE_MISMATCH",
      message: `Uploaded file does not match expected ${args.cardType} type`,
    });
  }

  const cardType = args.cardType;
  const additionalMeta = args.additionalMetadata || {};
  const fileMetadataObj = {
    fileName: args.fileName,
    fileSize: args.storedFileSize ?? args.fileSize,
    mimeType: storedFileType ?? fileType,
    ...(additionalMeta.recordingTimestamp && {
      recordingTimestamp: additionalMeta.recordingTimestamp,
    }),
    ...(additionalMeta.duration && { duration: additionalMeta.duration }),
    ...(additionalMeta.width && { width: additionalMeta.width }),
    ...(additionalMeta.height && { height: additionalMeta.height }),
  };

  const {
    recordingTimestamp: _recordingTimestamp,
    duration: _duration,
    width: _width,
    height: _height,
    fileName: _fileName,
    fileSize: _fileSize,
    mimeType: _mimeType,
    ...nonFileMetadata
  } = additionalMeta;

  const hasNonFileMetadata = Object.values(nonFileMetadata).some(
    (v) => v !== undefined
  );
  const metadata = hasNonFileMetadata ? nonFileMetadata : undefined;

  const cardId = await ctx.db.insert("cards", {
    userId: args.userId,
    content: args.content || "",
    type: cardType,
    fileKey: args.fileKey,
    fileMetadata: fileMetadataObj,
    notes: args.notes ?? undefined,
    tags: args.tags,
    metadata,
    processingStatus: buildInitialProcessingStatus({
      now,
      cardType,
      classificationStatus: stageCompleted(now, 1),
    }),
    createdAt: now,
    updatedAt: now,
  });

  await ctx.scheduler.runAfter(
    0,
    (internal as any).storage.r2.syncUploadedObjectMetadata,
    { key: args.fileKey }
  );

  await ctx.scheduler.runAfter(
    0,
    (internal as any)["workflows/manager"].startCardProcessingWorkflow,
    { cardId }
  );

  await scheduleCardOutcome(ctx, {
    cardId,
    cardType,
    outcome: "success",
    source: "unknown",
    userId: args.userId,
  });
  await scheduleUploadOutcome(ctx, {
    bytes: args.storedFileSize ?? args.fileSize,
    fileBucket: cardType,
    outcome: "success",
    userId: args.userId,
  });

  return cardId;
};

// Mutation to finalize card creation after successful upload
export const finalizeUploadedCard = mutation({
  args: {
    fileKey: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    fileType: v.optional(v.string()),
    cardType: cardTypeValidator,
    content: v.optional(v.string()),
    additionalMetadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    cardId: v.optional(v.id("cards")),
    error: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      const cardId = await createUploadedCardForUser(ctx, {
        additionalMetadata: args.additionalMetadata,
        cardType: args.cardType,
        content: args.content,
        fileKey: args.fileKey,
        fileName: args.fileName,
        fileSize: args.fileSize,
        fileType: args.fileType,
        notes: undefined,
        tags: undefined,
        userId: user.subject,
      });

      return { success: true, cardId };
    } catch (error) {
      await scheduleCardOutcome(ctx, {
        cardType: args.cardType,
        errorClass: error instanceof Error ? error.name : "UnknownError",
        outcome: "failure",
        source: "unknown",
        userId: user.subject,
      });
      await scheduleUploadOutcome(ctx, {
        bytes: args.fileSize,
        fileBucket: args.cardType,
        outcome: "failure",
        userId: user.subject,
      });
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data
      ) {
        const { code, message } = error.data as {
          code?: string;
          message?: string;
        };
        if (code) {
          return {
            success: false,
            errorCode: code,
            error: message,
          };
        }
      }
      console.error("Failed to finalize uploaded card:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card",
      };
    }
  },
});
