"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import { IMPORT_PART_BYTES, IMPORT_UPLOAD_TTL_MS } from "./import/constants";
import { importModeValidator } from "./schema";
import { getSessionUser, type TeakUserId } from "./securitySessions";
import {
  IMPORT_SOURCES,
  type ImportMode,
  importContentType,
  importFileMatches,
} from "./shared/importSources";
import {
  buildSignedMultipartPartUrl,
  callFilesWorkerJson,
} from "./storage/filesWorkerClient";
import { getR2Url } from "./storage/fileUrls";
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

async function requireUserId(ctx: ActionCtx): Promise<TeakUserId> {
  const identity = await getSessionUser(ctx);
  if (!identity) {
    throw new Error("User must be authenticated");
  }
  return identity.teakUserId;
}

function validateSource(mode: ImportMode, fileName: string, fileSize: number) {
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
  const source = IMPORT_SOURCES[mode];
  if (!importFileMatches(mode, fileName)) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: `Choose a ${source.extensions.join(" or ")} file from ${source.title}`,
    });
  }
  if (fileSize > source.maxBytes) {
    const limit =
      source.maxBytes >= 1024 ** 3
        ? `${source.maxBytes / 1024 ** 3} GiB`
        : `${source.maxBytes / 1024 ** 2} MiB`;
    throw new ConvexError({
      code: "FILE_TOO_LARGE",
      message: `${source.title} files are limited to ${limit}`,
    });
  }
}

function totalParts(fileSize: number) {
  return Math.ceil(fileSize / IMPORT_PART_BYTES);
}

interface RecordedPart {
  etag: string;
  partNumber: number;
  size: number;
}

function recordedParts(job: { uploadedParts?: RecordedPart[] }) {
  return [...(job.uploadedParts ?? [])].sort(
    (left, right) => left.partNumber - right.partNumber
  );
}

async function signMissingParts(args: {
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
    const url = await buildSignedMultipartPartUrl({
      key: args.key,
      uploadId: args.uploadId,
      partNumber,
      size: Math.min(
        IMPORT_PART_BYTES,
        args.fileSize - (partNumber - 1) * IMPORT_PART_BYTES
      ),
      ttlSeconds: URL_TTL_SECONDS,
    });
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
      const creation = await callFilesWorkerJson<{ uploadId: string }>({
        op: "create-multipart",
        params: {
          key: sourceKey,
          contentType: importContentType(args.fileName),
        },
      });
      if (creation.kind !== "ok" || !creation.data.uploadId) {
        throw new Error("R2 did not return an upload ID");
      }
      const created = { UploadId: creation.data.uploadId };
      await ctx.runMutation(internalAny.dataImport.attachMultipart, {
        jobId,
        uploadId: created.UploadId,
      });
      const parts = await signMissingParts({
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
    const uploadedParts = recordedParts(job).map((part) => part.partNumber);
    const parts = await signMissingParts({
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
    const parts = recordedParts(job);
    const expected = totalParts(job.fileSize);
    if (
      parts.length !== expected ||
      parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      throw new ConvexError({
        code: "INCOMPLETE_UPLOAD",
        message: "Not all upload parts are present",
      });
    }
    const recordedSize = parts.reduce((sum, part) => sum + part.size, 0);
    if (
      recordedSize !== job.fileSize ||
      parts.slice(0, -1).some((part) => part.size !== IMPORT_PART_BYTES)
    ) {
      throw new ConvexError({
        code: "INVALID_UPLOAD",
        message: "Uploaded part sizes do not match the selected file",
      });
    }
    const completion = await callFilesWorkerJson<{ size: number }>({
      op: "complete-multipart",
      params: {
        key: job.sourceKey,
        uploadId: job.uploadId,
        expectedSize: job.fileSize,
        parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
      },
    });
    if (completion.kind !== "ok" || completion.data.size !== job.fileSize) {
      await callFilesWorkerJson({
        op: "delete-objects",
        params: { keys: [job.sourceKey] },
      });
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
      const result = await callFilesWorkerJson({
        op: "abort-multipart",
        params: { key: state.sourceKey, uploadId: state.uploadId },
      });
      if (result.kind !== "ok") {
        throw new Error("import_abort_unconfirmed");
      }
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
    return await getR2Url(job.reportKey, {
      contentDisposition: 'attachment; filename="teak-import-report.txt"',
      contentType: "text/plain; charset=utf-8",
    });
  },
});
