import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ensureCardCreationAllowed } from "./auth";
import { createUploadedCardForUser } from "./card/uploadCard";
import { type CardType, cardTypeValidator } from "./schema";
import {
  FileFormatValidationError,
  fileUploadErrorCode,
  MAX_FILE_SIZE,
  validateFileName,
  validateUploadFile,
} from "./shared/fileFormats";
import {
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
  MarkdownContentError,
  validateMarkdownByteLength,
} from "./shared/markdown";
import { buildR2ObjectKey, r2 } from "./storage/r2";

const UPLOAD_URL_EXPIRES_IN_SECONDS = 60 * 10;

const sanitizeFileName = (fileName: string): string => {
  try {
    return validateFileName(fileName);
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      throw new ConvexError({
        code: fileUploadErrorCode(error),
        message: error.message,
      });
    }
    throw error;
  }
};

const validateUploadRequest = (args: {
  fileName: string;
  fileSize: number;
  mimeType: string;
}) => {
  try {
    const validated = validateUploadFile(args);
    if (isMarkdownFileName(validated.fileName)) {
      validateMarkdownByteLength(args.fileSize);
    }
    return validated;
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      throw new ConvexError({
        code: fileUploadErrorCode(error),
        message: error.message,
      });
    }
    if (error instanceof MarkdownContentError) {
      throw new ConvexError({ code: error.code, message: error.message });
    }
    throw error;
  }
};

export const generateUploadUrlForUser = internalMutation({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    expiresIn: v.number(),
    fileKey: v.string(),
    maxFileSize: v.number(),
    method: v.literal("PUT"),
    uploadUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    const { fileName } = validateUploadRequest(args);
    await ensureCardCreationAllowed(ctx, args.userId);
    const upload = await r2.generateUploadUrl(
      buildR2ObjectKey({ userId: args.userId, role: "file", fileName })
    );
    return {
      expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
      fileKey: upload.key,
      maxFileSize: isMarkdownFileName(fileName)
        ? MARKDOWN_CONTENT_MAX_BYTES
        : MAX_FILE_SIZE,
      method: "PUT" as const,
      uploadUrl: upload.url,
    };
  },
});

export const finalizeUploadedCardForUser = internalMutation({
  args: {
    additionalMetadata: v.optional(v.any()),
    cardType: v.optional(cardTypeValidator),
    content: v.optional(v.string()),
    fileKey: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    storedFileSize: v.number(),
    storedMimeType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    userId: v.string(),
  },
  returns: v.object({
    cardId: v.id("cards"),
    status: v.literal("created"),
  }),
  handler: async (ctx, args) => {
    const cardId = await createUploadedCardForUser(ctx, {
      additionalMetadata: args.additionalMetadata,
      cardType: args.cardType as CardType,
      content: args.content,
      fileKey: args.fileKey,
      fileName: sanitizeFileName(args.fileName),
      fileSize: args.fileSize,
      fileType: args.mimeType,
      notes: args.notes,
      storedFileSize: args.storedFileSize,
      storedFileType: args.storedMimeType,
      tags: args.tags,
      userId: args.userId,
    });
    return { cardId, status: "created" as const };
  },
});
