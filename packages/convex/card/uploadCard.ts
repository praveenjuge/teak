import { ConvexError, v } from "convex/values";
import { type MutationCtx, mutation } from "../_generated/server";
import { type CardType, cardTypeValidator } from "../schema";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import type { CardCreationSource } from "../shared/analytics";
import {
  type FileFormat,
  FileFormatValidationError,
  fileUploadErrorCode,
  isGenericMimeType,
  MAX_FILE_SIZE,
  validateFileFormat,
  validateUploadFile,
} from "../shared/fileFormats";
import {
  isMarkdownFileName,
  MarkdownContentError,
  validateMarkdownByteLength,
} from "../shared/markdown";
import { buildSignedWorkerUploadUrl } from "../storage/filesWorkerClient";
import { ensureObjectOwnership } from "../storage/ownership";
import {
  buildR2ObjectKey,
  buildR2UserPrefix,
  PENDING_UPLOAD_CARD_ID,
} from "../storage/r2";
import { scheduleCardOutcome } from "../telemetry/schedule";
import { queueCardProcessing } from "../workflowDispatch";
import { insertCountedCard } from "./cardUsage";
import {
  buildInitialProcessingStatus,
  stageCompleted,
} from "./processingStatus";
import { authorizeCardCreation, ensureCardQuotaAvailable } from "./quota";
import { syncCardSearch } from "./searchDocumentHelpers";
import { newShuffleKey } from "./shuffle";

const toConvexFileError = (error: FileFormatValidationError) =>
  new ConvexError({
    code: fileUploadErrorCode(error),
    message: error.message,
  });

export const validateDirectUploadRequest = (args: {
  fileName: string;
  fileSize: number;
  fileType: string;
}) => {
  try {
    const validated = validateUploadFile({
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.fileType,
    });
    if (isMarkdownFileName(validated.fileName)) {
      validateMarkdownByteLength(args.fileSize);
    }
    return validated;
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      throw toConvexFileError(error);
    }
    if (error instanceof MarkdownContentError) {
      throw new ConvexError({ code: error.code, message: error.message });
    }
    throw error;
  }
};

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
    const user = await getSessionUser(ctx);
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      const validated = validateDirectUploadRequest(_args);
      if (
        _args.cardType &&
        !isMarkdownFileName(validated.fileName) &&
        _args.cardType !== validated.format.cardType
      ) {
        throw new ConvexError({
          code: "TYPE_MISMATCH",
          message: `Uploaded file does not match expected ${_args.cardType} type`,
        });
      }

      await ensureCardQuotaAvailable(ctx, user.teakUserId);

      const key = buildR2ObjectKey({
        userId: user.teakUserId,
        cardId: PENDING_UPLOAD_CARD_ID,
        role: "file",
        fileName: _args.fileName,
      });
      await ensureObjectOwnership(ctx, user.teakUserId, key);
      const signed = await buildSignedWorkerUploadUrl({
        contentType: _args.fileType || "application/octet-stream",
        key,
        size: _args.fileSize,
      });

      return {
        success: true,
        uploadKey: signed.key,
        uploadUrl: signed.url,
        cardId: undefined,
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

const UPLOAD_FILE_FACT_FIELDS = [
  "recordingTimestamp",
  "duration",
  "width",
  "height",
] as const;

// Picks the file facts a client measured. A fact of the wrong type is refused,
// as the schema would refuse it on insert; a zero or missing fact is skipped.
const readUploadFileFacts = (
  metadata: unknown
): Partial<Record<(typeof UPLOAD_FILE_FACT_FIELDS)[number], number>> => {
  const facts: Partial<
    Record<(typeof UPLOAD_FILE_FACT_FIELDS)[number], number>
  > = {};
  if (typeof metadata !== "object" || metadata === null) {
    return facts;
  }
  for (const field of UPLOAD_FILE_FACT_FIELDS) {
    const value: unknown = Reflect.get(metadata, field);
    if (!value) {
      continue;
    }
    if (typeof value !== "number") {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `additionalMetadata.${field} must be a number`,
      });
    }
    facts[field] = value;
  }
  return facts;
};

export const createUploadedCardForUser = async (
  ctx: MutationCtx,
  args: {
    additionalMetadata?: unknown;
    cardType?: CardType;
    content?: string;
    fileKey: string;
    fileName: string;
    fileSize?: number;
    fileType?: string;
    storedFileSize?: number;
    storedFileType?: string;
    /** Where the file came from, kept as `metadata.source` (e.g. "email"). */
    metadataSource?: string;
    notes?: string | null;
    source?: CardCreationSource;
    tags?: string[];
    userId: TeakUserId;
  }
) => {
  const now = Date.now();

  const { hasPremium } = await authorizeCardCreation(ctx, args.userId);

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
  const fileFacts = readUploadFileFacts(args.additionalMetadata);
  const fileMetadataObj = {
    extension: storedFormat.extension,
    fileName: args.fileName,
    fileSize: args.storedFileSize ?? args.fileSize,
    kind: storedFormat.kind,
    language: storedFormat.language,
    mimeType: resolvedMimeType,
    ...(storedFormat.id === "gif" && { preview: { animated: true } }),
    ...fileFacts,
  };

  const cardId = await insertCountedCard(
    ctx,
    {
      userId: args.userId,
      shuffleKey: newShuffleKey(),
      content: args.content || "",
      type: cardType,
      fileKey: args.fileKey,
      fileMetadata: fileMetadataObj,
      metadataTitle: args.fileName,
      notes: args.notes ?? undefined,
      tags: args.tags,
      metadata: args.metadataSource
        ? { source: args.metadataSource }
        : undefined,
      processingStatus: buildInitialProcessingStatus({
        now,
        cardType,
        classificationStatus: stageCompleted(now, 1),
      }),
      createdAt: now,
      updatedAt: now,
    },
    { hasPremium }
  );
  await syncCardSearch(ctx, cardId, args.userId);

  await queueCardProcessing(ctx, cardId, { reset: true });

  await scheduleCardOutcome(ctx, {
    cardId,
    cardType,
    outcome: "success",
    source: args.source ?? "unknown",
    userId: args.userId,
  });
  return cardId;
};
