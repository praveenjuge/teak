"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, action, internalAction } from "../_generated/server";
import type { EmailAttachmentClaim } from "../inbound/attachmentClaims";
import { cardTypeValidator } from "../schema";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import type { CardCreationSource } from "../shared/analytics";
import {
  FileFormatValidationError,
  fileUploadErrorCode,
  inferFileFormat,
  MAX_FILE_SIZE,
  validateFileFormat,
  validateFileName,
} from "../shared/fileFormats";
import {
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
} from "../shared/markdown";
import {
  callFilesWorkerJson,
  type FilesWorkerFinalizeImageResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { ensureObjectOwnership } from "../storage/ownership";
import { buildR2ObjectKey, buildR2UserPrefix } from "../storage/r2";
import { clientCardSourceValidator } from "./createCard";

const finalizeArgs = {
  additionalMetadata: v.optional(v.any()),
  cardType: v.optional(cardTypeValidator),
  content: v.optional(v.string()),
  fileEtag: v.optional(v.string()),
  fileKey: v.string(),
  fileName: v.string(),
  fileSize: v.optional(v.number()),
  fileType: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
} as const;

const sessionFinalizeArgs = {
  ...finalizeArgs,
  source: v.optional(clientCardSourceValidator),
} as const;

const finalizeResult = v.object({
  success: v.boolean(),
  cardId: v.optional(v.id("cards")),
  error: v.optional(v.string()),
  errorCode: v.optional(v.string()),
});

interface FinalizeArgs {
  additionalMetadata?: unknown;
  cardType?:
    | "text"
    | "link"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "palette"
    | "quote";
  content?: string;
  /** A fixed id for the stored key, so a retried finalize writes one object. */
  destinationObjectId?: string;
  /** A Save by email attachment's claim on its receipt (inbound/). */
  emailAttachment?: EmailAttachmentClaim;
  fileEtag?: string;
  fileKey: string;
  fileName: string;
  fileSize?: number;
  fileType?: string;
  notes?: string | null;
  source?: CardCreationSource;
  tags?: string[];
}

interface FinalizedUpload {
  content?: string;
  destinationKey: string;
  sourceEtag: string;
  storedEtag: string;
  storedFileSize: number;
  storedMimeType?: string;
}

const throwUploadError = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

const normalizeMimeType = (value?: string): string | undefined => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
};

export const validateFinalizeUpload = (
  userId: TeakUserId,
  args: FinalizeArgs
): {
  fileEtag?: string;
  fileName: string;
  markdown: boolean;
  requestedMimeType?: string;
} => {
  let fileName: string;
  try {
    fileName = validateFileName(args.fileName);
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      return throwUploadError(fileUploadErrorCode(error), error.message);
    }
    throw error;
  }
  if (!args.fileKey.startsWith(`${buildR2UserPrefix(userId)}/`)) {
    return throwUploadError(
      "INVALID_STORAGE_KEY",
      "Uploaded file key does not belong to the current user"
    );
  }
  const fileEtag = args.fileEtag?.startsWith("W/")
    ? args.fileEtag.slice(2)
    : args.fileEtag;
  if (
    fileEtag !== undefined &&
    !/^"?[A-Za-z0-9+/=_-]{1,128}"?$/u.test(fileEtag)
  ) {
    return throwUploadError("INVALID_INPUT", "Uploaded file ETag is invalid");
  }
  const markdown = isMarkdownFileName(fileName);
  const maxBytes = markdown ? MARKDOWN_CONTENT_MAX_BYTES : MAX_FILE_SIZE;
  if (
    args.fileSize === undefined ||
    !Number.isSafeInteger(args.fileSize) ||
    args.fileSize < 0 ||
    args.fileSize > maxBytes
  ) {
    return throwUploadError(
      markdown ? "CONTENT_TOO_LARGE" : "FILE_TOO_LARGE",
      `Uploaded file must not exceed ${maxBytes} bytes`
    );
  }
  const requestedMimeType = normalizeMimeType(args.fileType);
  try {
    validateFileFormat({ fileName, mimeType: requestedMimeType });
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      return throwUploadError(fileUploadErrorCode(error), error.message);
    }
    throw error;
  }
  return { fileEtag, fileName, markdown, requestedMimeType };
};

export const finalizeForUser = async (
  ctx: ActionCtx,
  userId: TeakUserId,
  args: FinalizeArgs
): Promise<{ success: true; cardId: Id<"cards"> }> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  const validated = validateFinalizeUpload(userId, args);
  const isImageUpload =
    inferFileFormat({ fileName: validated.fileName })?.cardType === "image";
  const destinationKey = buildR2ObjectKey({
    userId,
    cardId: "stored",
    role: "file",
    fileName: validated.fileName,
    objectId: args.destinationObjectId,
  });
  await ensureObjectOwnership(ctx, userId, destinationKey);
  const outcome = await callFilesWorkerJson<
    FinalizedUpload | FilesWorkerFinalizeImageResult
  >({
    op: isImageUpload ? "finalize-image-upload" : "finalize-upload",
    params: {
      destinationKey,
      expectedEtag: validated.fileEtag,
      expectedSize: args.fileSize,
      readText: validated.markdown ? true : undefined,
      sourceKey: args.fileKey,
    },
  });
  if (outcome.kind !== "ok") {
    if (isImageUpload) {
      return throwUploadError(
        "INVALID_INPUT",
        "Uploaded file is not a decodable image"
      );
    }
    return throwUploadError("INVALID_INPUT", "Uploaded file was not found");
  }
  const finalized = outcome.data;
  const trustedImageFacts =
    isImageUpload && "decodedFormat" in finalized
      ? (finalized as FilesWorkerFinalizeImageResult)
      : null;
  const storedMimeType = normalizeMimeType(outcome.data.storedMimeType);
  const verifiedMimeType = normalizeMimeType(
    trustedImageFacts?.decodedFormat ?? storedMimeType
  );
  try {
    const requested = validateFileFormat({
      fileName: validated.fileName,
      mimeType: validated.requestedMimeType,
    });
    const stored = validateFileFormat({
      fileName: validated.fileName,
      mimeType: verifiedMimeType,
    });
    if (requested.id !== stored.id) {
      return throwUploadError(
        "INVALID_INPUT",
        "Uploaded file type does not match the stored object"
      );
    }
  } catch (error) {
    await callFilesWorkerJson({
      op: "delete-object",
      params: { key: destinationKey },
    }).catch(() => undefined);
    if (error instanceof ConvexError) {
      throw error;
    }
    if (error instanceof FileFormatValidationError) {
      return throwUploadError(fileUploadErrorCode(error), error.message);
    }
    throw error;
  }

  const additionalMetadata =
    typeof args.additionalMetadata === "object" &&
    args.additionalMetadata !== null &&
    !Array.isArray(args.additionalMetadata)
      ? { ...(args.additionalMetadata as Record<string, unknown>) }
      : {};
  // Dimensions are security- and layout-relevant image facts. Never carry
  // client claims through when the worker is the source of truth.
  const trustedAdditionalMetadata = isImageUpload
    ? Object.fromEntries(
        Object.entries(additionalMetadata).filter(
          ([key]) => key !== "height" && key !== "width"
        )
      )
    : additionalMetadata;

  try {
    const result = await ctx.runMutation(
      (internal as any).publicApiUploads.finalizeUploadedCardForUser,
      {
        additionalMetadata: {
          ...trustedAdditionalMetadata,
          ...(trustedImageFacts?.width && trustedImageFacts?.height
            ? {
                height: trustedImageFacts.height,
                width: trustedImageFacts.width,
              }
            : {}),
        },
        cardType: validated.markdown ? "text" : args.cardType,
        content: validated.markdown ? outcome.data.content : args.content,
        ...(args.emailAttachment
          ? { emailAttachment: args.emailAttachment }
          : {}),
        fileKey: destinationKey,
        fileName: validated.fileName,
        fileSize: args.fileSize,
        mimeType: verifiedMimeType ?? args.fileType,
        notes: args.notes ?? undefined,
        source: args.source,
        storedFileSize: outcome.data.storedFileSize,
        storedMimeType,
        tags: args.tags,
        userId,
      }
    );
    await ctx
      .runMutation(internal.fileUploads.consumeSessionBySourceKey, {
        sourceKey: args.fileKey,
      })
      .catch(() => undefined);
    return { success: true, cardId: result.cardId };
  } catch (error) {
    // Another finalize owns this attachment and may already point a card at
    // the same fixed key; the object is theirs.
    const claimLost =
      error instanceof ConvexError &&
      (error.data as { code?: string })?.code === "IN_PROGRESS";
    if (!claimLost) {
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key: destinationKey },
      }).catch(() => undefined);
    }
    throw error;
  }
};

export const finalizeUploadedCardForUser = internalAction({
  args: { ...finalizeArgs, userId: v.string() },
  returns: finalizeResult,
  handler: async (ctx, { userId, ...args }) =>
    finalizeForUser(ctx, await requireTeakUserId(ctx, userId), {
      ...args,
      source: "api",
    }),
});

export const finalizeUploadedCard = action({
  args: sessionFinalizeArgs,
  returns: finalizeResult,
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }
    try {
      return await finalizeForUser(ctx, user.teakUserId, args);
    } catch (error) {
      if (error instanceof ConvexError && error.data) {
        const data = error.data as { code?: string; message?: string };
        return { success: false, errorCode: data.code, error: data.message };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card",
      };
    }
  },
});
