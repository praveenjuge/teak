"use node";

import {
  FileFormatValidationError,
  fileUploadErrorCode,
  inferFileFormat,
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
  MAX_FILE_SIZE,
  validateFileFormat,
  validateFileName,
} from "@teak/files-core";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, action, internalAction } from "../_generated/server";
import { cardTypeValidator } from "../schema";
import { getSessionIdentity } from "../securitySessions";
import {
  callFilesWorkerJson,
  type FilesWorkerFinalizeImageResult,
  type FilesWorkerFinalizeUploadResult,
  type FilesWorkerOutcome,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { buildR2ObjectKey, buildR2UserPrefix } from "../storage/r2";

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
  fileEtag?: string;
  fileKey: string;
  fileName: string;
  fileSize?: number;
  fileType?: string;
  notes?: string | null;
  tags?: string[];
}

const throwUploadError = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

const normalizeMimeType = (value?: string): string | undefined => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
};

export const validateFinalizeUpload = (
  userId: string,
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

const finalizeForUser = async (
  ctx: ActionCtx,
  userId: string,
  args: FinalizeArgs
): Promise<{ success: true; cardId: Id<"cards"> }> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  const validated = validateFinalizeUpload(userId, args);
  // Image uploads are committed through a decode-verify op so the card gets
  // trusted format/dimension facts from the worker instead of client input.
  const isImageUpload =
    inferFileFormat({ fileName: validated.fileName })?.cardType === "image";
  const destinationKey = buildR2ObjectKey({
    userId,
    cardId: "stored",
    role: "file",
    fileName: validated.fileName,
  });
  const finalizeParams = {
    destinationKey,
    expectedEtag: validated.fileEtag,
    expectedSize: args.fileSize,
    sourceKey: args.fileKey,
  };
  let outcome:
    | FilesWorkerOutcome<FilesWorkerFinalizeImageResult>
    | FilesWorkerOutcome<FilesWorkerFinalizeUploadResult>;
  try {
    outcome = isImageUpload
      ? await callFilesWorkerJson({
          op: "finalize-image-upload",
          params: finalizeParams,
        })
      : await callFilesWorkerJson({
          op: "finalize-upload",
          params: {
            ...finalizeParams,
            fileName: validated.fileName,
            readText: validated.markdown ? true : undefined,
            requestedMimeType: validated.requestedMimeType,
          },
        });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("files_worker_error:INVALID_INPUT")
    ) {
      // Verification runs before anything is stored; the delete is
      // best-effort hygiene for partially written destinations.
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key: destinationKey },
      }).catch(() => undefined);
      return throwUploadError(
        "TYPE_MISMATCH",
        "Uploaded file does not match its name or type"
      );
    }
    throw error;
  }
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
  const trustedUploadFacts =
    !isImageUpload && "verificationLevel" in finalized
      ? (finalized as FilesWorkerFinalizeUploadResult)
      : null;
  // Worker-returned MIME, dimensions, and facts are authoritative. Convex
  // re-checks only that the verified format still matches the request.
  if (trustedUploadFacts) {
    const requested = validateFileFormat({
      fileName: validated.fileName,
      mimeType: validated.requestedMimeType,
    });
    if (requested.id !== trustedUploadFacts.formatId) {
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key: destinationKey },
      }).catch(() => undefined);
      return throwUploadError(
        "TYPE_MISMATCH",
        "Uploaded file type does not match the stored object"
      );
    }
  }
  const verifiedMimeType = normalizeMimeType(
    trustedImageFacts?.decodedFormat ?? trustedUploadFacts?.mimeType
  );
  const storedMimeType = normalizeMimeType(finalized.storedMimeType);

  const additionalMetadata =
    typeof args.additionalMetadata === "object" &&
    args.additionalMetadata !== null &&
    !Array.isArray(args.additionalMetadata)
      ? { ...(args.additionalMetadata as Record<string, unknown>) }
      : {};
  const workerFacts = {
    ...(trustedImageFacts?.width && trustedImageFacts?.height
      ? { height: trustedImageFacts.height, width: trustedImageFacts.width }
      : {}),
    ...(trustedUploadFacts?.facts?.width && trustedUploadFacts.facts.height
      ? {
          height: trustedUploadFacts.facts.height,
          width: trustedUploadFacts.facts.width,
        }
      : {}),
    ...(trustedUploadFacts?.facts?.duration
      ? { duration: trustedUploadFacts.facts.duration }
      : {}),
  };
  // Worker-verified facts win on conflict. Client claims survive only as a
  // fallback when bounded worker inspection cannot derive the fact (AAC
  // duration, AVI/ASF dimensions, non-fast-start MP4 metadata); dropping
  // them unconditionally would lose valid mobile picker metadata.
  const trustedAdditionalMetadata = Object.fromEntries(
    Object.entries(additionalMetadata).filter(([key]) => !(key in workerFacts))
  );

  try {
    const result = await ctx.runMutation(
      (internal as any).publicApiUploads.finalizeUploadedCardForUser,
      {
        additionalMetadata: {
          ...trustedAdditionalMetadata,
          ...workerFacts,
        },
        cardType: validated.markdown ? "text" : args.cardType,
        colors:
          trustedImageFacts && trustedImageFacts.palette.length > 0
            ? trustedImageFacts.palette.map((hex) => ({ hex }))
            : undefined,
        content: validated.markdown
          ? (finalized as FilesWorkerFinalizeUploadResult).content
          : args.content,
        fileKey: destinationKey,
        fileName: validated.fileName,
        fileSize: args.fileSize,
        mimeType: verifiedMimeType ?? args.fileType,
        notes: args.notes ?? undefined,
        processing: {
          generatedAt: Date.now(),
          processorVersion: finalized.processorVersion,
          sourceEtag: finalized.sourceEtag,
          storedEtag: finalized.storedEtag,
          verificationLevel: finalized.verificationLevel,
        },
        storedFileSize: finalized.storedFileSize,
        storedMimeType,
        tags: args.tags,
        userId,
      }
    );
    const sessionConsumed = await ctx
      .runMutation(internal.fileUploads.consumeSessionBySourceKey, {
        sourceKey: args.fileKey,
      })
      .then(() => true)
      .catch(() => false);
    if (sessionConsumed) {
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key: args.fileKey },
      }).catch(() => undefined);
    }
    return { success: true, cardId: result.cardId };
  } catch (error) {
    await callFilesWorkerJson({
      op: "delete-object",
      params: { key: destinationKey },
    }).catch(() => undefined);
    throw error;
  }
};

export const finalizeUploadedCardForUser = internalAction({
  args: { ...finalizeArgs, userId: v.string() },
  returns: finalizeResult,
  handler: (ctx, { userId, ...args }) => finalizeForUser(ctx, userId, args),
});

export const finalizeUploadedCard = action({
  args: finalizeArgs,
  returns: finalizeResult,
  handler: async (ctx, args) => {
    const user = await getSessionIdentity(ctx);
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }
    try {
      return await finalizeForUser(ctx, user.subject, args);
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
