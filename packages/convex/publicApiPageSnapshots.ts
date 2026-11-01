import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { requireTeakUserId } from "./securitySessions";
import {
  PAGE_SNAPSHOT_MAX_BYTES,
  PAGE_SNAPSHOT_ROLE,
} from "./shared/pageArchive";
import { RATE_LIMIT_CONFIG, rateLimiter } from "./shared/rateLimits";
import { buildSignedWorkerUploadUrl } from "./storage/filesWorkerClient";
import { registerOwnedObject } from "./storage/ownership";
import { buildR2ObjectKey, PENDING_UPLOAD_CARD_ID } from "./storage/r2";

const UPLOAD_URL_EXPIRES_IN_SECONDS = 60 * 10;
export const PAGE_SNAPSHOT_CONTENT_TYPE = "application/gzip";

export const pageSnapshotUploadValidator = v.object({
  expiresIn: v.number(),
  fileKey: v.string(),
  maxFileSize: v.number(),
  method: v.literal("PUT"),
  uploadUrl: v.string(),
});

/**
 * A signed PUT for the page the browser extension saw, in the pending-upload
 * namespace the stale-upload sweep clears, with the owner's claim recorded
 * first. Its key goes into `POST /v1/cards` as `pageSnapshotKey`.
 */
export const createPageSnapshotUpload = async (
  ctx: MutationCtx,
  userId: string,
  { bytes }: { bytes: number }
) => {
  if (!(Number.isSafeInteger(bytes) && bytes > 0)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "`bytes` must be a positive whole number",
    });
  }
  if (bytes > PAGE_SNAPSHOT_MAX_BYTES) {
    throw new ConvexError({
      code: "PAGE_SNAPSHOT_TOO_LARGE",
      message: `A page snapshot can be at most ${PAGE_SNAPSHOT_MAX_BYTES} bytes`,
    });
  }
  const allowed = await rateLimiter.limit(ctx, "pageSnapshotUploads", {
    key: userId,
    throws: false,
  });
  if (!allowed.ok) {
    throw new ConvexError({
      code: "RATE_LIMITED",
      limit: RATE_LIMIT_CONFIG.pageSnapshotUploads.capacity,
      message: "Too many page snapshots. Try again in a minute.",
      retryAt: Date.now() + allowed.retryAfter,
    });
  }
  const key = buildR2ObjectKey({
    userId,
    cardId: PENDING_UPLOAD_CARD_ID,
    role: PAGE_SNAPSHOT_ROLE,
  });
  if (!(await registerOwnedObject(ctx, userId, key))) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "This account can't store new files",
    });
  }
  const signed = await buildSignedWorkerUploadUrl({
    contentType: PAGE_SNAPSHOT_CONTENT_TYPE,
    key,
    size: bytes,
    ttlSeconds: UPLOAD_URL_EXPIRES_IN_SECONDS,
  });
  return {
    expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
    fileKey: key,
    maxFileSize: PAGE_SNAPSHOT_MAX_BYTES,
    method: "PUT" as const,
    uploadUrl: signed.url,
  };
};

export const createPageSnapshotUploadForUser = internalMutation({
  args: { bytes: v.number(), userId: v.string() },
  returns: pageSnapshotUploadValidator,
  handler: async (ctx, { bytes, userId }) =>
    createPageSnapshotUpload(ctx, await requireTeakUserId(ctx, userId), {
      bytes,
    }),
});
