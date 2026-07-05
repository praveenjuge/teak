import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ensureCardCreationAllowed } from "./auth";
import { createUploadedCardForUser } from "./card/uploadCard";
import { type CardType, cardTypeValidator } from "./schema";
import { MAX_FILE_SIZE } from "./shared/constants";
import { buildR2ObjectKey, r2 } from "./storage/r2";

const MAX_FILE_NAME_LENGTH = 240;
const UPLOAD_URL_EXPIRES_IN_SECONDS = 60 * 10;

const sanitizeFileName = (fileName: string): string => {
  const trimmed = fileName.trim().replace(/[\\/]/g, "-");
  if (!(trimmed && trimmed.length <= MAX_FILE_NAME_LENGTH)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message:
        "fileName must be 1-240 characters and cannot include path separators",
    });
  }
  return trimmed;
};

const validateUploadRequest = (args: {
  fileName: string;
  fileSize: number;
  mimeType: string;
}) => {
  if (!(Number.isFinite(args.fileSize) && args.fileSize > 0)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "fileSize must be a positive number",
    });
  }
  if (args.fileSize > MAX_FILE_SIZE) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `fileSize must not exceed ${MAX_FILE_SIZE} bytes`,
    });
  }
  const mimeType = args.mimeType.trim().toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "mimeType must be a valid media type",
    });
  }
  return { fileName: sanitizeFileName(args.fileName), mimeType };
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
    await ensureCardCreationAllowed(ctx, args.userId);
    const { fileName } = validateUploadRequest(args);
    const upload = await r2.generateUploadUrl(
      buildR2ObjectKey({ userId: args.userId, role: "file", fileName })
    );
    return {
      expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
      fileKey: upload.key,
      maxFileSize: MAX_FILE_SIZE,
      method: "PUT" as const,
      uploadUrl: upload.url,
    };
  },
});

export const finalizeUploadedCardForUser = internalMutation({
  args: {
    cardType: cardTypeValidator,
    content: v.optional(v.string()),
    fileKey: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    userId: v.string(),
  },
  returns: v.object({
    cardId: v.id("cards"),
    status: v.literal("created"),
  }),
  handler: async (ctx, args) => {
    const cardId = await createUploadedCardForUser(ctx, {
      cardType: args.cardType as CardType,
      content: args.content,
      fileKey: args.fileKey,
      fileName: sanitizeFileName(args.fileName),
      fileSize: args.fileSize,
      fileType: args.mimeType,
      notes: args.notes,
      tags: args.tags,
      userId: args.userId,
    });
    return { cardId, status: "created" as const };
  },
});
