import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action, mutation } from "./_generated/server";
import {
  IMPORT_PART_BYTES,
  IMPORT_UPLOAD_TTL_MS,
  MAX_ARCHIVE_BYTES,
  MAX_BOOKMARK_BYTES,
  MAX_RAINDROP_BYTES,
} from "./import/constants";
import { importModeValidator } from "./schema";
import { getSessionIdentity } from "./securitySessions";
import {
  buildSignedMultipartPartUrl,
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./storage/filesWorkerClient";
import { buildR2ObjectKey, getR2Url } from "./storage/r2";
import { assertR2KeyInNamespace } from "./storage/r2Keys";

const internalAny = internal as Record<string, any>;

const partValidator = v.object({ partNumber: v.number(), url: v.string() });
const uploadResultValidator = v.object({
  jobId: v.id("importJobs"),
  partSize: v.number(),
  uploadedParts: v.array(v.number()),
  parts: v.array(partValidator),
});

async function requireUserId(ctx: ActionCtx) {
  const identity = await getSessionIdentity(ctx);
  if (!identity) {
    throw new Error("User must be authenticated");
  }
  return identity.subject as string;
}

function requireWorker() {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
}

function validateSource(
  mode: "bookmarks" | "archive" | "raindrop",
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
  if (mode === "raindrop" && !extension.endsWith(".csv")) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: "Choose a Raindrop CSV file",
    });
  }
  if (mode === "archive" && !extension.endsWith(".zip")) {
    throw new ConvexError({
      code: "INVALID_FILE",
      message: "Choose a Teak ZIP archive",
    });
  }
  let limit = MAX_ARCHIVE_BYTES;
  if (mode === "bookmarks") {
    limit = MAX_BOOKMARK_BYTES;
  } else if (mode === "raindrop") {
    limit = MAX_RAINDROP_BYTES;
  }
  if (fileSize > limit) {
    let message = "Teak archives are limited to 5 GiB";
    if (mode === "bookmarks") {
      message = "Bookmark files are limited to 20 MiB";
    } else if (mode === "raindrop") {
      message = "Raindrop CSV files are limited to 20 MiB";
    }
    throw new ConvexError({
      code: "FILE_TOO_LARGE",
      message,
    });
  }
}

function contentTypeForMode(mode: "bookmarks" | "archive" | "raindrop") {
  if (mode === "bookmarks") {
    return "text/html";
  }
  if (mode === "raindrop") {
    return "text/csv";
  }
  return "application/zip";
}

function totalParts(fileSize: number) {
  return Math.ceil(fileSize / IMPORT_PART_BYTES);
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
    // Signed Worker part URLs expire after one hour; resume re-signs them.
    const url = await buildSignedMultipartPartUrl({
      key: args.key,
      partNumber,
      uploadId: args.uploadId,
    });
    parts.push({ partNumber, url });
  }
  return parts;
}

async function createWorkerUpload(args: {
  key: string;
  contentType: string;
}): Promise<string> {
  assertR2KeyInNamespace(args.key);
  const created = await callFilesWorkerJson({
    op: "create-multipart",
    params: { key: args.key, contentType: args.contentType },
  });
  if (created.kind !== "ok" || !created.data.uploadId) {
    throw new Error("Worker did not return an upload ID");
  }
  return created.data.uploadId;
}

async function abortWorkerUpload(key: string, uploadId: string | undefined) {
  if (!uploadId) {
    return;
  }
  await callFilesWorkerJson({
    op: "abort-multipart",
    params: { key, uploadId },
  }).catch(() => undefined);
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
    requireWorker();
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
      const uploadId = await createWorkerUpload({
        key: sourceKey,
        contentType: contentTypeForMode(args.mode),
      });
      await ctx.runMutation(internalAny.dataImport.attachMultipart, {
        jobId,
        uploadId,
      });
      const parts = await signMissingParts({
        key: sourceKey,
        uploadId,
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

export const recordImportUploadPart = mutation({
  args: {
    jobId: v.id("importJobs"),
    partNumber: v.number(),
    etag: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getSessionIdentity(ctx);
    if (!identity) {
      throw new Error("User must be authenticated");
    }
    await ctx.runMutation(internalAny["import/uploadParts"].recordUploadPart, {
      ...args,
      userId: identity.subject as string,
    });
    return null;
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
    requireWorker();
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
    if (job.uploadTransport !== "worker" || !Array.isArray(job.uploadParts)) {
      // Pre-cutover direct-S3 upload: abort the orphaned multipart upload and
      // restart Worker transport within the same import job.
      await abortWorkerUpload(job.sourceKey, job.uploadId);
      await ctx.runMutation(
        internalAny["import/uploadParts"].restartUploadTransport,
        {
          jobId: job._id,
          userId,
          uploadExpiresAt: Date.now() + IMPORT_UPLOAD_TTL_MS,
        }
      );
      const uploadId = await createWorkerUpload({
        key: job.sourceKey,
        contentType: contentTypeForMode(job.mode),
      });
      await ctx.runMutation(internalAny.dataImport.attachMultipart, {
        jobId: job._id,
        uploadId,
      });
      const parts = await signMissingParts({
        key: job.sourceKey,
        uploadId,
        fileSize: job.fileSize,
        uploaded: [],
      });
      return {
        jobId: job._id,
        partSize: IMPORT_PART_BYTES,
        uploadedParts: [],
        parts,
      };
    }
    const uploadedParts = (job.uploadParts as Array<{ partNumber: number }>)
      .map((part) => part.partNumber)
      .sort((left, right) => left - right);
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
  returns: v.union(v.null(), v.object({ restartRequired: v.literal(true) })),
  handler: async (ctx, { jobId }) => {
    const userId = await requireUserId(ctx);
    requireWorker();
    const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
    if (
      !job ||
      job.userId !== userId ||
      job.status !== "uploading" ||
      !job.uploadId
    ) {
      throw new Error("Import upload not found");
    }
    if (job.uploadTransport !== "worker" || !Array.isArray(job.uploadParts)) {
      // An old page finishing a pre-cutover upload: restart Worker transport
      // and report it so the client re-uploads instead of hanging.
      await abortWorkerUpload(job.sourceKey, job.uploadId);
      await ctx.runMutation(
        internalAny["import/uploadParts"].restartUploadTransport,
        {
          jobId,
          userId,
          uploadExpiresAt: Date.now() + IMPORT_UPLOAD_TTL_MS,
        }
      );
      const uploadId = await createWorkerUpload({
        key: job.sourceKey,
        contentType: contentTypeForMode(job.mode),
      });
      await ctx.runMutation(internalAny.dataImport.attachMultipart, {
        jobId,
        uploadId,
      });
      return { restartRequired: true as const };
    }
    assertR2KeyInNamespace(job.sourceKey);
    const parts = [...job.uploadParts].sort(
      (left, right) => left.partNumber - right.partNumber
    );
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
    const listedSize = parts.reduce((sum, part) => sum + part.size, 0);
    if (
      listedSize !== job.fileSize ||
      parts.slice(0, -1).some((part) => part.size !== IMPORT_PART_BYTES)
    ) {
      throw new ConvexError({
        code: "INVALID_UPLOAD",
        message: "Uploaded part sizes do not match the selected file",
      });
    }
    const completed = await callFilesWorkerJson({
      op: "complete-multipart",
      params: {
        key: job.sourceKey,
        uploadId: job.uploadId,
        expectedSize: job.fileSize,
        parts: parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
        })),
      },
    });
    if (completed.kind !== "ok") {
      throw new ConvexError({
        code: "INVALID_UPLOAD",
        message: "Upload completion was rejected",
      });
    }
    if (completed.data.size !== job.fileSize) {
      await callFilesWorkerJson({
        op: "delete-object",
        params: { key: job.sourceKey },
      }).catch(() => undefined);
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
      requireWorker();
      await abortWorkerUpload(state.sourceKey, state.uploadId);
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
    requireWorker();
    const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
    if (!job || job.userId !== userId || !job.reportKey) {
      throw new Error("Import report is unavailable");
    }
    // The report key ends in error-report.txt, so attachment disposition keeps
    // the download filename without embedding it in the signed URL.
    return await getR2Url(job.reportKey, { contentDisposition: "attachment" });
  },
});
