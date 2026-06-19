"use node";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  IMPORT_PART_BYTES,
  IMPORT_UPLOAD_TTL_MS,
  MAX_ARCHIVE_BYTES,
  MAX_BOOKMARK_BYTES,
} from "./import/constants";
import { createImportS3Client, getImportR2Config } from "./import/r2Client";
import { importModeValidator } from "./schema";
import { buildR2ObjectKey } from "./storage/r2";

const internalAny = internal as Record<string, any>;
const URL_TTL_SECONDS = 24 * 60 * 60;

const partValidator = v.object({ partNumber: v.number(), url: v.string() });
const uploadResultValidator = v.object({
  jobId: v.id("importJobs"),
  partSize: v.number(),
  uploadedParts: v.array(v.number()),
  parts: v.array(partValidator),
});

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<any> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("User must be authenticated");
  }
  return identity.subject as string;
}

function validateSource(
  mode: "bookmarks" | "archive",
  fileName: string,
  fileSize: number
) {
  if (
    !fileName.trim() ||
    fileName.length > 255 ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0
  ) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: "Import file is invalid",
    });
  }
  const extension = fileName.toLowerCase();
  if (
    mode === "bookmarks" &&
    !(extension.endsWith(".html") || extension.endsWith(".htm"))
  ) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: "Choose a bookmarks HTML file",
    });
  }
  if (mode === "archive" && !extension.endsWith(".zip")) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: "Choose a Teak ZIP archive",
    });
  }
  const limit = mode === "bookmarks" ? MAX_BOOKMARK_BYTES : MAX_ARCHIVE_BYTES;
  if (fileSize > limit) {
    throw new ConvexError({
      code: "FILE_TOO_LARGE",
      message:
        mode === "bookmarks"
          ? "Bookmark files are limited to 20 MiB"
          : "Teak archives are limited to 5 GiB",
    });
  }
}

function totalParts(fileSize: number) {
  return Math.ceil(fileSize / IMPORT_PART_BYTES);
}

async function listAllParts(
  client: ReturnType<typeof createImportS3Client>,
  bucket: string,
  key: string,
  uploadId: string
) {
  const result: Array<{ PartNumber: number; ETag: string; Size: number }> = [];
  let marker: string | undefined;
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      })
    );
    for (const part of page.Parts ?? []) {
      if (part.PartNumber && part.ETag && typeof part.Size === "number") {
        result.push({
          PartNumber: part.PartNumber,
          ETag: part.ETag,
          Size: part.Size,
        });
      }
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return result.sort((a, b) => a.PartNumber - b.PartNumber);
}

async function signMissingParts(args: {
  client: ReturnType<typeof createImportS3Client>;
  bucket: string;
  key: string;
  uploadId: string;
  fileSize: number;
  uploaded: number[];
}) {
  const uploaded = new Set(args.uploaded);
  const parts: Array<{ partNumber: number; url: string }> = [];
  for (
    let partNumber = 1;
    partNumber <= totalParts(args.fileSize);
    partNumber += 1
  ) {
    if (uploaded.has(partNumber)) {
      continue;
    }
    const url = await getSignedUrl(
      args.client,
      new UploadPartCommand({
        Bucket: args.bucket,
        Key: args.key,
        UploadId: args.uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: URL_TTL_SECONDS }
    );
    parts.push({ partNumber, url });
  }
  return parts;
}

export const createImportUpload = action({
  args: {
    mode: importModeValidator,
    fileName: v.string(),
    fileSize: v.number(),
    fileLastModified: v.number(),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    validateSource(args.mode, args.fileName, args.fileSize);
    const config = getImportR2Config();
    const client = createImportS3Client(config);
    const sourceKey = buildR2ObjectKey({
      userId,
      role: "import-source",
      fileName: args.fileName,
    });
    const jobId = await ctx.runMutation(internalAny.dataImport.reserveJob, {
      ...args,
      userId,
      sourceKey,
      uploadExpiresAt: Date.now() + IMPORT_UPLOAD_TTL_MS,
    });
    try {
      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: sourceKey,
          ContentType:
            args.mode === "bookmarks" ? "text/html" : "application/zip",
        })
      );
      if (!created.UploadId) {
        throw new Error("R2 did not return an upload ID");
      }
      await ctx.runMutation(internalAny.dataImport.attachMultipart, {
        jobId,
        uploadId: created.UploadId,
      });
      const parts = await signMissingParts({
        client,
        bucket: config.bucket,
        key: sourceKey,
        uploadId: created.UploadId,
        fileSize: args.fileSize,
        uploaded: [],
      });
      return { jobId, partSize: IMPORT_PART_BYTES, uploadedParts: [], parts };
    } catch (error) {
      await ctx.runMutation(internalAny.dataImport.finishJob, {
        jobId,
        status: "failed",
        failureClass: "upload_setup_failed",
      });
      throw error;
    }
  },
});

export const resumeImportUpload = action({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    fileLastModified: v.number(),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.runQuery(internalAny.dataImport.findUploadForUser, {
      userId,
    });
    if (!job?.uploadId) {
      throw new ConvexError({
        code: "NO_UPLOAD",
        message: "No resumable import was found",
      });
    }
    if (
      job.fileName !== args.fileName ||
      job.fileSize !== args.fileSize ||
      job.fileLastModified !== args.fileLastModified
    ) {
      throw new ConvexError({
        code: "FILE_MISMATCH",
        message: "Select the same file to resume this import",
      });
    }
    if ((job.uploadExpiresAt ?? 0) <= Date.now()) {
      throw new ConvexError({
        code: "UPLOAD_EXPIRED",
        message: "This upload has expired",
      });
    }
    const config = getImportR2Config();
    const client = createImportS3Client(config);
    const listed = await listAllParts(
      client,
      config.bucket,
      job.sourceKey,
      job.uploadId
    );
    const uploadedParts = listed.map((part) => part.PartNumber);
    const parts = await signMissingParts({
      client,
      bucket: config.bucket,
      key: job.sourceKey,
      uploadId: job.uploadId,
      fileSize: job.fileSize,
      uploaded: uploadedParts,
    });
    return {
      jobId: job._id,
      partSize: IMPORT_PART_BYTES,
      uploadedParts,
      parts,
    };
  },
});

export const completeImportUpload = action({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
    if (
      !job ||
      job.userId !== userId ||
      job.status !== "uploading" ||
      !job.uploadId
    ) {
      throw new Error("Import upload not found");
    }
    const config = getImportR2Config();
    const client = createImportS3Client(config);
    const parts = await listAllParts(
      client,
      config.bucket,
      job.sourceKey,
      job.uploadId
    );
    const expected = totalParts(job.fileSize);
    if (
      parts.length !== expected ||
      parts.some((part, index) => part.PartNumber !== index + 1)
    ) {
      throw new ConvexError({
        code: "INCOMPLETE_UPLOAD",
        message: "Not all upload parts are present",
      });
    }
    const listedSize = parts.reduce((sum, part) => sum + part.Size, 0);
    if (
      listedSize !== job.fileSize ||
      parts.slice(0, -1).some((part) => part.Size !== IMPORT_PART_BYTES)
    ) {
      throw new ConvexError({
        code: "INVALID_UPLOAD",
        message: "Uploaded part sizes do not match the selected file",
      });
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: job.sourceKey,
        UploadId: job.uploadId,
        MultipartUpload: {
          Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
        },
      })
    );
    const head = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
    );
    if (head.ContentLength !== job.fileSize) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
      );
      throw new ConvexError({
        code: "INVALID_UPLOAD",
        message: "Completed upload size is invalid",
      });
    }
    await ctx.runMutation(internalAny.dataImport.markQueued, { jobId });
    return null;
  },
});

export const cancelImport = action({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ canceled: v.boolean() }),
  handler: async (ctx, { jobId }) => {
    const userId = await requireUserId(ctx);
    const state = await ctx.runMutation(
      internalAny.dataImport.markCancelRequested,
      { jobId, userId }
    );
    if (!state.active) {
      return { canceled: false };
    }
    if (state.uploadId) {
      const config = getImportR2Config();
      const client = createImportS3Client(config);
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: config.bucket,
            Key: state.sourceKey,
            UploadId: state.uploadId,
          })
        )
        .catch(() => undefined);
      await ctx.runMutation(internalAny.dataImport.finishJob, {
        jobId,
        status: "canceled",
      });
    }
    return { canceled: true };
  },
});

export const getImportReportUrl = action({
  args: { jobId: v.id("importJobs") },
  returns: v.string(),
  handler: async (ctx, { jobId }) => {
    const userId = await requireUserId(ctx);
    const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
    if (!job || job.userId !== userId || !job.reportKey) {
      throw new Error("Import report is unavailable");
    }
    const config = getImportR2Config();
    return getSignedUrl(
      createImportS3Client(config),
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: job.reportKey,
        ResponseContentDisposition:
          'attachment; filename="teak-import-report.txt"',
      }),
      { expiresIn: 15 * 60 }
    );
  },
});
