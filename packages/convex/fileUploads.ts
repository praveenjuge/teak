import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { ensureCardCreationAllowed } from "./auth";
import { validateDirectUploadRequest } from "./card/uploadCard";
import { MULTIPART_UPLOAD_THRESHOLD } from "./shared/constants";
import {
  buildSignedMultipartPartUrl,
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./storage/filesWorkerClient";
import { buildR2ObjectKey, PENDING_UPLOAD_CARD_ID } from "./storage/r2";

export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessionResult = v.object({
  sessionId: v.id("fileUploadSessions"),
  uploadKey: v.string(),
  partSize: v.number(),
  uploadedParts: v.array(v.number()),
  partUrls: v.array(
    v.object({ partNumber: v.number(), uploadUrl: v.string() })
  ),
});

interface SessionResponse {
  partSize: number;
  partUrls: Array<{ partNumber: number; uploadUrl: string }>;
  sessionId: Id<"fileUploadSessions">;
  uploadedParts: number[];
  uploadKey: string;
}

const requireIdentity = async (ctx: Pick<ActionCtx, "auth">) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User must be authenticated",
    });
  }
  return identity;
};

const signMissingParts = async (session: {
  fileSize: number;
  partSize: number;
  parts: Array<{ partNumber: number }>;
  sourceKey: string;
  uploadId: string;
}) => {
  const uploaded = new Set(session.parts.map((part) => part.partNumber));
  const count = Math.ceil(session.fileSize / session.partSize);
  return await Promise.all(
    Array.from({ length: count }, (_, index) => index + 1)
      .filter((partNumber) => !uploaded.has(partNumber))
      .map(async (partNumber) => ({
        partNumber,
        uploadUrl: await buildSignedMultipartPartUrl({
          key: session.sourceKey,
          partNumber,
          uploadId: session.uploadId,
        }),
      }))
  );
};

export const insertSession = internalMutation({
  args: {
    sourceKey: v.string(),
    uploadId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    fileLastModified: v.number(),
  },
  returns: v.id("fileUploadSessions"),
  handler: async (ctx, args): Promise<Id<"fileUploadSessions">> => {
    const identity = await requireIdentity(ctx);
    await ensureCardCreationAllowed(ctx, identity.subject);
    const now = Date.now();
    return await ctx.db.insert("fileUploadSessions", {
      ...args,
      identityKey: identity.tokenIdentifier,
      userId: identity.subject,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      partSize: MULTIPART_PART_SIZE,
      parts: [],
      status: "uploading",
      updatedAt: now,
    });
  },
});

export const getSessionForUser = internalQuery({
  args: { sessionId: v.id("fileUploadSessions") },
  handler: async (ctx, { sessionId }) => {
    const identity = await requireIdentity(ctx);
    const session = await ctx.db.get(sessionId);
    return session?.identityKey === identity.tokenIdentifier ? session : null;
  },
});

export const findActiveSession = internalQuery({
  args: {
    fileLastModified: v.number(),
    fileName: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args): Promise<Doc<"fileUploadSessions"> | null> => {
    const identity = await requireIdentity(ctx);
    const session = await ctx.db
      .query("fileUploadSessions")
      .withIndex("by_identity_file", (query) =>
        query
          .eq("identityKey", identity.tokenIdentifier)
          .eq("fileName", args.fileName)
          .eq("fileSize", args.fileSize)
          .eq("fileLastModified", args.fileLastModified)
      )
      .order("desc")
      .first();
    return session &&
      ["uploading", "completed"].includes(session.status) &&
      session.expiresAt > Date.now()
      ? session
      : null;
  },
});

export const prepareMultipartUpload = action({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    fileLastModified: v.number(),
  },
  returns: sessionResult,
  handler: async (ctx, args): Promise<SessionResponse> => {
    const identity = await requireIdentity(ctx);
    validateDirectUploadRequest(args);
    if (args.fileSize < MULTIPART_UPLOAD_THRESHOLD) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Multipart upload is reserved for large files",
      });
    }
    if (!isFilesWorkerConfigured()) {
      throw new Error("files_worker_not_configured");
    }
    const existing: Doc<"fileUploadSessions"> | null = await ctx.runQuery(
      internal.fileUploads.findActiveSession,
      {
        fileLastModified: args.fileLastModified,
        fileName: args.fileName,
        fileSize: args.fileSize,
      }
    );
    if (existing) {
      return {
        sessionId: existing._id,
        uploadKey: existing.sourceKey,
        partSize: existing.partSize,
        uploadedParts: existing.parts.map((part) => part.partNumber),
        partUrls: await signMissingParts(existing),
      };
    }
    const sourceKey = buildR2ObjectKey({
      userId: identity.subject,
      cardId: PENDING_UPLOAD_CARD_ID,
      role: "file",
      fileName: `${crypto.randomUUID()}-${args.fileName}`,
    });
    const created = await callFilesWorkerJson<{
      key: string;
      uploadId: string;
    }>({
      op: "create-multipart",
      params: { key: sourceKey, contentType: args.fileType },
    });
    if (created.kind !== "ok") {
      throw new Error("multipart_create_rejected");
    }
    let sessionId: Id<"fileUploadSessions">;
    try {
      sessionId = await ctx.runMutation(internal.fileUploads.insertSession, {
        ...args,
        sourceKey,
        uploadId: created.data.uploadId,
      });
    } catch (error) {
      await callFilesWorkerJson({
        op: "abort-multipart",
        params: { key: sourceKey, uploadId: created.data.uploadId },
      }).catch(() => undefined);
      throw error;
    }
    const session = {
      fileSize: args.fileSize,
      partSize: MULTIPART_PART_SIZE,
      parts: [],
      sourceKey,
      uploadId: created.data.uploadId,
    };
    return {
      sessionId,
      uploadKey: sourceKey,
      partSize: MULTIPART_PART_SIZE,
      uploadedParts: [],
      partUrls: await signMissingParts(session),
    };
  },
});

export const recordMultipartPart = mutation({
  args: {
    sessionId: v.id("fileUploadSessions"),
    partNumber: v.number(),
    etag: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (
      !session ||
      session.identityKey !== identity.tokenIdentifier ||
      session.status !== "uploading" ||
      session.expiresAt <= Date.now()
    ) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload expired" });
    }
    const totalParts = Math.ceil(session.fileSize / session.partSize);
    const expectedSize =
      args.partNumber === totalParts
        ? session.fileSize - session.partSize * (totalParts - 1)
        : session.partSize;
    if (
      args.partNumber < 1 ||
      args.partNumber > totalParts ||
      args.size !== expectedSize ||
      !/^"?[A-Za-z0-9+/=_-]{1,128}"?$/u.test(args.etag)
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Uploaded part metadata is invalid",
      });
    }
    const parts = session.parts
      .filter((part) => part.partNumber !== args.partNumber)
      .concat({ partNumber: args.partNumber, etag: args.etag, size: args.size })
      .sort((left, right) => left.partNumber - right.partNumber);
    await ctx.db.patch(args.sessionId, { parts, updatedAt: Date.now() });
    return null;
  },
});

export const resumeMultipartUpload = action({
  args: { sessionId: v.id("fileUploadSessions") },
  returns: sessionResult,
  handler: async (ctx, { sessionId }): Promise<SessionResponse> => {
    const session: Doc<"fileUploadSessions"> | null = await ctx.runQuery(
      internal.fileUploads.getSessionForUser,
      { sessionId }
    );
    if (session?.status !== "uploading" || session.expiresAt <= Date.now()) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload expired" });
    }
    return {
      sessionId,
      uploadKey: session.sourceKey,
      partSize: session.partSize,
      uploadedParts: session.parts.map((part) => part.partNumber),
      partUrls: await signMissingParts(session),
    };
  },
});

export const markSessionCompleted = internalMutation({
  args: {
    completedEtag: v.string(),
    completedSize: v.number(),
    sessionId: v.id("fileUploadSessions"),
  },
  returns: v.null(),
  handler: async (ctx, { completedEtag, completedSize, sessionId }) => {
    await ctx.db.patch(sessionId, {
      completedEtag,
      completedSize,
      status: "completed",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const completeMultipartUpload = action({
  args: { sessionId: v.id("fileUploadSessions") },
  returns: v.object({
    uploadKey: v.string(),
    etag: v.string(),
    size: v.number(),
  }),
  handler: async (
    ctx,
    { sessionId }
  ): Promise<{ etag: string; size: number; uploadKey: string }> => {
    const session: Doc<"fileUploadSessions"> | null = await ctx.runQuery(
      internal.fileUploads.getSessionForUser,
      { sessionId }
    );
    if (!(session && ["uploading", "completed"].includes(session.status))) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found" });
    }
    if (
      session.status === "completed" &&
      session.completedEtag &&
      session.completedSize === session.fileSize
    ) {
      return {
        uploadKey: session.sourceKey,
        etag: session.completedEtag,
        size: session.completedSize,
      };
    }
    const totalParts = Math.ceil(session.fileSize / session.partSize);
    if (session.parts.length !== totalParts) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Upload has incomplete parts",
      });
    }
    const completed = await callFilesWorkerJson<{
      etag: string;
      key: string;
      size: number;
    }>({
      op: "complete-multipart",
      params: {
        key: session.sourceKey,
        expectedSize: session.fileSize,
        parts: session.parts.map((part) => ({
          etag: part.etag,
          partNumber: part.partNumber,
        })),
        uploadId: session.uploadId,
      },
    });
    if (completed.kind !== "ok" || completed.data.size !== session.fileSize) {
      throw new Error("multipart_complete_failed");
    }
    await ctx.runMutation(internal.fileUploads.markSessionCompleted, {
      completedEtag: completed.data.etag,
      completedSize: completed.data.size,
      sessionId,
    });
    return {
      uploadKey: completed.data.key,
      etag: completed.data.etag,
      size: completed.data.size,
    };
  },
});

export const findExpiredSessions = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) =>
    await ctx.db
      .query("fileUploadSessions")
      .withIndex("by_expires_at", (query) => query.lt("expiresAt", now))
      .take(Math.min(limit, 50)),
});

export const consumeSessionBySourceKey = internalMutation({
  args: { sourceKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { sourceKey }) => {
    const session = await ctx.db
      .query("fileUploadSessions")
      .withIndex("by_source_key", (query) => query.eq("sourceKey", sourceKey))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

export const deleteSession = internalMutation({
  args: { sessionId: v.id("fileUploadSessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    await ctx.db.delete(sessionId);
    return null;
  },
});

export const cleanupExpiredMultipartUploads = internalAction({
  args: {},
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx) => {
    const sessions = await ctx.runQuery(
      internal.fileUploads.findExpiredSessions,
      { limit: 50, now: Date.now() }
    );
    let cleaned = 0;
    for (const session of sessions) {
      if (session.status === "uploading") {
        await callFilesWorkerJson({
          op: "abort-multipart",
          params: { key: session.sourceKey, uploadId: session.uploadId },
        }).catch(() => undefined);
      }
      await ctx.runMutation(internal.fileUploads.deleteSession, {
        sessionId: session._id,
      });
      cleaned += 1;
    }
    return { cleaned };
  },
});
