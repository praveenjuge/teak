import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { clientCardSourceValidator } from "./card/createCard";
import { ensureCardQuotaAvailable } from "./card/quota";
import { createUploadedCardForUser } from "./card/uploadCard";
import {
  checkEmailAttachmentClaim,
  completeEmailAttachment,
  emailAttachmentClaimValidator,
} from "./inbound/attachmentClaims";
import { type CardType, cardTypeValidator } from "./schema";
import { requireTeakUserId } from "./securitySessions";
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
import { buildSignedWorkerUploadUrl } from "./storage/filesWorkerClient";
import { ensureObjectOwnership } from "./storage/ownership";
import { buildR2ObjectKey, PENDING_UPLOAD_CARD_ID } from "./storage/r2";

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

/**
 * A signed upload URL for a file not yet on a card, under the pending prefix
 * the stale-upload sweep clears, with the owner's claim on the key recorded
 * first. Throws at the card limit or for a file Teak doesn't take.
 */
export const mintPendingUpload = async (
  ctx: MutationCtx,
  userId: string,
  args: { fileName: string; fileSize: number; mimeType: string }
) => {
  const { fileName } = validateUploadRequest(args);
  await ensureCardQuotaAvailable(ctx, userId);
  const key = buildR2ObjectKey({
    userId: await requireTeakUserId(ctx, userId),
    cardId: PENDING_UPLOAD_CARD_ID,
    role: "file",
    fileName,
  });
  await ensureObjectOwnership(ctx, userId, key);
  return {
    fileName,
    ...(await signPendingUpload({
      key,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
    })),
  };
};

/** A fresh signed URL for a pending key minted earlier. */
export const signPendingUpload = async (args: {
  fileSize: number;
  key: string;
  mimeType: string;
}) => {
  const signed = await buildSignedWorkerUploadUrl({
    contentType: args.mimeType || "application/octet-stream",
    key: args.key,
    size: args.fileSize,
    ttlSeconds: UPLOAD_URL_EXPIRES_IN_SECONDS,
  });
  return {
    expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
    fileKey: signed.key,
    uploadUrl: signed.url,
  };
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
  handler: async (ctx, { userId, ...args }) => {
    const minted = await mintPendingUpload(ctx, userId, args);
    return {
      expiresIn: minted.expiresIn,
      fileKey: minted.fileKey,
      maxFileSize: isMarkdownFileName(minted.fileName)
        ? MARKDOWN_CONTENT_MAX_BYTES
        : MAX_FILE_SIZE,
      method: "PUT" as const,
      uploadUrl: minted.uploadUrl,
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
    /** A Save by email attachment: its card is recorded on the receipt. */
    emailAttachment: v.optional(emailAttachmentClaimValidator),
    source: v.optional(
      v.union(clientCardSourceValidator, v.literal("api"), v.literal("email"))
    ),
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
    // An attachment finalized before (a retry) keeps its card; one another
    // finalize now owns is refused, so it never makes a second card.
    const claimed = args.emailAttachment
      ? await checkEmailAttachmentClaim(ctx, args.emailAttachment)
      : null;
    if (claimed) {
      return { cardId: claimed, status: "created" as const };
    }
    const cardId = await createUploadedCardForUser(ctx, {
      ...(args.emailAttachment ? { metadataSource: "email" } : {}),
      additionalMetadata: args.additionalMetadata,
      cardType: args.cardType as CardType,
      content: args.content,
      fileKey: args.fileKey,
      fileName: sanitizeFileName(args.fileName),
      fileSize: args.fileSize,
      fileType: args.mimeType,
      notes: args.notes,
      source: args.source,
      storedFileSize: args.storedFileSize,
      storedFileType: args.storedMimeType,
      tags: args.tags,
      userId: await requireTeakUserId(ctx, args.userId),
    });
    if (args.emailAttachment) {
      await completeEmailAttachment(ctx, args.emailAttachment, cardId);
    }
    return { cardId, status: "created" as const };
  },
});
