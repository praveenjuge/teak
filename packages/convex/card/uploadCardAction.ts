"use node";

import {
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, action, internalAction } from "../_generated/server";
import { cardTypeValidator } from "../schema";
import {
  FileFormatValidationError,
  fileUploadErrorCode,
  MAX_FILE_SIZE,
  validateFileFormat,
  validateFileName,
} from "../shared/fileFormats";
import {
  decodeMarkdownUtf8,
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
  MARKDOWN_CONTENT_TOO_LARGE_MESSAGE,
  MarkdownContentError,
} from "../shared/markdown";
import { buildR2UserPrefix, r2ComponentConfig } from "../storage/r2";

const finalizeArgs = {
  additionalMetadata: v.optional(v.any()),
  cardType: v.optional(cardTypeValidator),
  content: v.optional(v.string()),
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
  fileKey: string;
  fileName: string;
  fileSize?: number;
  fileType?: string;
  notes?: string | null;
  tags?: string[];
}

const convexUploadError = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

const normalizeMimeType = (value?: string): string | undefined => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
};

const createClient = () => {
  const config = r2ComponentConfig();
  return {
    bucket: config.bucket,
    client: new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
  };
};

export async function inspectUploadedCardSource(
  userId: string,
  args: FinalizeArgs,
  storage = createClient()
): Promise<{
  cardType: FinalizeArgs["cardType"];
  content?: string;
  storedFileSize: number;
  storedMimeType?: string;
}> {
  let fileName: string;
  try {
    fileName = validateFileName(args.fileName);
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      return convexUploadError(fileUploadErrorCode(error), error.message);
    }
    throw error;
  }

  if (!args.fileKey.startsWith(`${buildR2UserPrefix(userId)}/`)) {
    return convexUploadError(
      "INVALID_STORAGE_KEY",
      "Uploaded file key does not belong to the current user"
    );
  }

  const { bucket, client } = storage;
  let head: HeadObjectCommandOutput;
  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: args.fileKey })
    );
  } catch {
    return convexUploadError("INVALID_INPUT", "Uploaded file was not found");
  }

  const storedFileSize = head.ContentLength;
  const sourceEtag = head.ETag;
  if (
    typeof storedFileSize !== "number" ||
    !Number.isFinite(storedFileSize) ||
    !sourceEtag
  ) {
    return convexUploadError(
      "INVALID_INPUT",
      "Uploaded file metadata is unavailable"
    );
  }
  if (args.fileSize !== undefined && args.fileSize !== storedFileSize) {
    return convexUploadError(
      "INVALID_INPUT",
      "Uploaded file size does not match the stored object"
    );
  }

  const markdown = isMarkdownFileName(fileName);
  const sizeLimit = markdown ? MARKDOWN_CONTENT_MAX_BYTES : MAX_FILE_SIZE;
  if (storedFileSize > sizeLimit) {
    return convexUploadError(
      markdown ? "CONTENT_TOO_LARGE" : "FILE_TOO_LARGE",
      markdown
        ? MARKDOWN_CONTENT_TOO_LARGE_MESSAGE
        : `Uploaded file must not exceed ${MAX_FILE_SIZE} bytes`
    );
  }

  const requestedMimeType = normalizeMimeType(args.fileType);
  const storedMimeType = normalizeMimeType(head.ContentType);
  try {
    const requested = validateFileFormat({
      fileName,
      mimeType: requestedMimeType,
    });
    const stored = validateFileFormat({
      fileName,
      mimeType: storedMimeType,
    });
    if (requested.id !== stored.id) {
      return convexUploadError(
        "INVALID_INPUT",
        "Uploaded file type does not match the stored object"
      );
    }
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      return convexUploadError(fileUploadErrorCode(error), error.message);
    }
    throw error;
  }

  if (!markdown) {
    return {
      cardType: args.cardType,
      content: args.content,
      storedFileSize,
      storedMimeType,
    };
  }

  try {
    const object = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: args.fileKey,
        IfMatch: sourceEtag,
      })
    );
    if (!(object.Body && object.ETag === sourceEtag)) {
      return convexUploadError(
        "CONFLICT",
        "Uploaded file changed before it could be saved"
      );
    }
    const bytes = await object.Body.transformToByteArray();
    if (bytes.byteLength !== storedFileSize) {
      return convexUploadError(
        "CONFLICT",
        "Uploaded file changed before it could be saved"
      );
    }
    const verified = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: args.fileKey })
    );
    if (
      verified.ETag !== sourceEtag ||
      verified.ContentLength !== storedFileSize
    ) {
      return convexUploadError(
        "CONFLICT",
        "Uploaded file changed before it could be saved"
      );
    }
    return {
      cardType: "text",
      content: decodeMarkdownUtf8(bytes),
      storedFileSize,
      storedMimeType,
    };
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    if (error instanceof MarkdownContentError) {
      return convexUploadError(error.code, error.message);
    }
    return convexUploadError(
      "INVALID_INPUT",
      "Uploaded Markdown file could not be read"
    );
  }
}

async function finalizeForUser(
  ctx: ActionCtx,
  userId: string,
  args: FinalizeArgs
): Promise<{ success: true; cardId: Id<"cards"> }> {
  const verified = await inspectUploadedCardSource(userId, args);
  const result: { cardId: Id<"cards">; status: "created" } =
    await ctx.runMutation(
      (internal as any).publicApiUploads.finalizeUploadedCardForUser,
      {
        cardType: verified.cardType,
        additionalMetadata: args.additionalMetadata,
        content: verified.content,
        fileKey: args.fileKey,
        fileName: args.fileName,
        fileSize: args.fileSize,
        mimeType: args.fileType,
        notes: args.notes ?? undefined,
        storedFileSize: verified.storedFileSize,
        storedMimeType: verified.storedMimeType,
        tags: args.tags,
        userId,
      }
    );
  return { success: true, cardId: result.cardId };
}

export const finalizeUploadedCardForUser = internalAction({
  args: { ...finalizeArgs, userId: v.string() },
  returns: finalizeResult,
  handler: (
    ctx,
    { userId, ...args }
  ): Promise<{ success: true; cardId: Id<"cards"> }> =>
    finalizeForUser(ctx, userId, args),
});

export const finalizeUploadedCard = action({
  args: finalizeArgs,
  returns: finalizeResult,
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    cardId?: Id<"cards">;
    error?: string;
    errorCode?: string;
  }> => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }
    try {
      return await finalizeForUser(ctx, user.subject, args);
    } catch (error) {
      if (error instanceof ConvexError && error.data) {
        const data = error.data as { code?: string; message?: string };
        return {
          success: false,
          errorCode: data.code,
          error: data.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card",
      };
    }
  },
});
