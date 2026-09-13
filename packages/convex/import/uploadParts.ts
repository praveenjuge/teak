import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { IMPORT_PART_BYTES } from "./constants";

/**
 * Worker-transport upload bookkeeping for import jobs. The Files Worker
 * moves bytes; these mutations track which parts landed so uploads can
 * resume after a restart without re-sending completed parts.
 */
export const recordUploadPart = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    userId: v.string(),
    partNumber: v.number(),
    etag: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.userId !== args.userId ||
      job.status !== "uploading" ||
      job.uploadTransport !== "worker" ||
      !job.uploadId ||
      (job.uploadExpiresAt ?? 0) <= Date.now()
    ) {
      throw new ConvexError({
        code: "NO_UPLOAD",
        message: "No resumable import was found",
      });
    }
    const totalParts = Math.ceil(job.fileSize / IMPORT_PART_BYTES);
    const expectedSize =
      args.partNumber === totalParts
        ? job.fileSize - IMPORT_PART_BYTES * (totalParts - 1)
        : IMPORT_PART_BYTES;
    if (
      args.partNumber < 1 ||
      args.partNumber > totalParts ||
      args.size !== expectedSize ||
      !/^"?[A-Za-z0-9+/=_-]{1,128}"?$/u.test(args.etag)
    ) {
      throw new ConvexError({
        code: "INVALID_PART",
        message: "Uploaded part metadata is invalid",
      });
    }
    const uploadParts = (job.uploadParts ?? [])
      .filter((part) => part.partNumber !== args.partNumber)
      .concat({
        partNumber: args.partNumber,
        etag: args.etag,
        size: args.size,
      })
      .sort((left, right) => left.partNumber - right.partNumber);
    await ctx.db.patch(args.jobId, { uploadParts, updatedAt: Date.now() });
    return null;
  },
});

export const restartUploadTransport = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    userId: v.string(),
    uploadExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, userId, uploadExpiresAt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId || job.status !== "uploading") {
      throw new Error("Import upload not found");
    }
    await ctx.db.patch(jobId, {
      uploadId: undefined,
      uploadTransport: "worker",
      uploadParts: [],
      uploadExpiresAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});
