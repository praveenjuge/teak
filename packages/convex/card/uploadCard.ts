import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { type MutationCtx, mutation } from "../_generated/server";
import { ensureCardCreationAllowed } from "../auth";
import { type CardType, cardTypeValidator } from "../schema";
import {
  type FileFormat,
  FileFormatValidationError,
  fileUploadErrorCode,
  isGenericMimeType,
  MAX_FILE_SIZE,
  validateFileFormat,
  validateUploadFile,
} from "../shared/fileFormats";
import { normalizeErrorClass } from "../shared/telemetry";
import { buildR2ObjectKey, buildR2UserPrefix, r2 } from "../storage/r2";
import {
  scheduleCardOutcome,
  scheduleUploadOutcome,
} from "../telemetry/schedule";
import {
  buildInitialProcessingStatus,
  stageCompleted,
} from "./processingStatus";

const toConvexFileError = (error: FileFormatValidationError) =>
  new ConvexError({
    code: fileUploadErrorCode(error),
    message: error.message,
  });

// Unified upload mutation that handles the complete upload-to-card pipeline
export const uploadAndCreateCard = mutation({
  args: {
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    cardType: v.optional(cardTypeValidator),
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

    try {
      try {
        const validated = validateUploadFile({
          fileName: _args.fileName,
          fileSize: _args.fileSize,
          mimeType: _args.fileType,
        });
        if (_args.cardType && _args.cardType !== validated.format.cardType) {
          throw new ConvexError({
            code: "TYPE_MISMATCH",
            message: `Uploaded file does not match expected ${_args.cardType} type`,
          });
        }
      } catch (error) {
        if (error instanceof FileFormatValidationError) {
          throw toConvexFileError(error);
        }
        throw error;
      }

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
    cardType?: CardType;
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

  if (!args.fileKey.startsWith(`${buildR2UserPrefix(args.userId)}/`)) {
    throw new ConvexError({
      code: "INVALID_STORAGE_KEY",
      message: "Uploaded file key does not belong to the current user",
    });
  }

  const fileType = args.fileType?.trim().toLowerCase();
  const storedFileType = args.storedFileType?.trim().toLowerCase();

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

  if (
    (args.storedFileSize ?? args.fileSize) !== undefined &&
    (args.storedFileSize ?? args.fileSize ?? 0) > MAX_FILE_SIZE
  ) {
    throw new ConvexError({
      code: "FILE_TOO_LARGE",
      message: `Uploaded file must not exceed ${MAX_FILE_SIZE} bytes`,
    });
  }

  let declaredFormat: FileFormat;
  let storedFormat: FileFormat;
  try {
    declaredFormat = validateFileFormat({
      fileName: args.fileName,
      mimeType: fileType,
    });
    storedFormat = validateFileFormat({
      fileName: args.fileName,
      mimeType: storedFileType,
    });
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      throw toConvexFileError(error);
    }
    throw error;
  }

  if (declaredFormat.id !== storedFormat.id) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file type does not match the stored object",
    });
  }

  const cardType = storedFormat.cardType;
  if (args.cardType && args.cardType !== cardType) {
    throw new ConvexError({
      code: "TYPE_MISMATCH",
      message: `Uploaded file does not match expected ${args.cardType} type`,
    });
  }

  let resolvedMimeType = storedFormat.mimeType;
  if (fileType && !isGenericMimeType(fileType)) {
    resolvedMimeType = fileType;
  }
  if (storedFileType && !isGenericMimeType(storedFileType)) {
    resolvedMimeType = storedFileType;
  }
  const additionalMeta = args.additionalMetadata || {};
  const fileMetadataObj = {
    extension: storedFormat.extension,
    fileName: args.fileName,
    fileSize: args.storedFileSize ?? args.fileSize,
    kind: storedFormat.kind,
    language: storedFormat.language,
    mimeType: resolvedMimeType,
    ...(storedFormat.id === "gif" && { preview: { animated: true } }),
    ...(additionalMeta.recordingTimestamp && {
      recordingTimestamp: additionalMeta.recordingTimestamp,
    }),
    ...(additionalMeta.duration && { duration: additionalMeta.duration }),
    ...(additionalMeta.width && { width: additionalMeta.width }),
    ...(additionalMeta.height && { height: additionalMeta.height }),
  };

  const cardId = await ctx.db.insert("cards", {
    userId: args.userId,
    content: args.content || "",
    type: cardType,
    fileKey: args.fileKey,
    fileMetadata: fileMetadataObj,
    metadataTitle: args.fileName,
    notes: args.notes ?? undefined,
    tags: args.tags,
    metadata: undefined,
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
  return cardId;
};

// Mutation to finalize card creation after successful upload
export const finalizeUploadedCard = mutation({
  args: {
    fileKey: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    fileType: v.optional(v.string()),
    cardType: v.optional(cardTypeValidator),
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

    await scheduleUploadOutcome(ctx, {
      bytes: args.fileSize,
      fileBucket: args.cardType ?? "unknown",
      outcome: "attempt",
      userId: user.subject,
    });

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

      await scheduleUploadOutcome(ctx, {
        bytes: args.fileSize,
        fileBucket: args.cardType ?? "unknown",
        outcome: "success",
        userId: user.subject,
      });

      return { success: true, cardId };
    } catch (error) {
      await scheduleCardOutcome(ctx, {
        cardType: args.cardType,
        errorClass: normalizeErrorClass(error),
        outcome: "failure",
        source: "unknown",
        userId: user.subject,
      });
      await scheduleUploadOutcome(ctx, {
        bytes: args.fileSize,
        errorClass: normalizeErrorClass(error),
        fileBucket: args.cardType ?? "unknown",
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
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card",
      };
    }
  },
});
