import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { API_IDEMPOTENCY_KEY_TTL_MS } from "./shared/constants";

const idempotencyStateValidator = v.union(
  v.literal("pending"),
  v.literal("completed")
);

const idempotencyRecordValidator = v.object({
  _id: v.id("apiIdempotencyKeys"),
  _creationTime: v.number(),
  userId: v.string(),
  keyHash: v.string(),
  method: v.string(),
  path: v.string(),
  requestHash: v.string(),
  state: idempotencyStateValidator,
  responseStatus: v.number(),
  responseBody: v.any(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const idempotencyReferenceArgs = {
  userId: v.string(),
  keyHash: v.string(),
} as const;

interface IdempotencyReference {
  keyHash: string;
  userId: string;
}

const ttlArg = {
  ttlMs: v.optional(v.number()),
} as const;

const getTtlMs = (ttlMs?: number): number =>
  typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : API_IDEMPOTENCY_KEY_TTL_MS;

/**
 * How long a pending reservation holds its key: Convex's ten-minute action
 * limit, which bounds the slowest idempotent request (an upload finalize,
 * whose Files Worker copy has no shorter timeout). A lapsed reservation
 * belongs to a handler that died before it could complete or release it, so
 * a retry takes the key over.
 */
export const IDEMPOTENCY_PENDING_LEASE_MS = 10 * 60 * 1000;

const getRecordForUser = (ctx: MutationCtx, args: IdempotencyReference) =>
  ctx.db
    .query("apiIdempotencyKeys")
    .withIndex("by_user_key_hash", (query) =>
      query.eq("userId", args.userId).eq("keyHash", args.keyHash)
    )
    .first();

export const beginIdempotencyRequestForUser = internalMutation({
  args: {
    ...idempotencyReferenceArgs,
    ...ttlArg,
    method: v.string(),
    path: v.string(),
    requestHash: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("started"),
      record: idempotencyRecordValidator,
    }),
    v.object({
      status: v.literal("replay"),
      record: idempotencyRecordValidator,
    }),
    v.object({
      status: v.literal("conflict"),
      record: idempotencyRecordValidator,
    }),
    v.object({
      status: v.literal("in_progress"),
      record: idempotencyRecordValidator,
    })
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt =
      now + Math.min(getTtlMs(args.ttlMs), IDEMPOTENCY_PENDING_LEASE_MS);
    const existing = await getRecordForUser(ctx, args);

    const pendingRecord = {
      userId: args.userId,
      keyHash: args.keyHash,
      method: args.method,
      path: args.path,
      requestHash: args.requestHash,
      state: "pending" as const,
      responseStatus: 0,
      responseBody: null,
      expiresAt,
      updatedAt: now,
    };

    if (existing && existing.expiresAt > now) {
      if (
        existing.method !== args.method ||
        existing.path !== args.path ||
        existing.requestHash !== args.requestHash
      ) {
        return {
          status: "conflict" as const,
          record: existing,
        };
      }

      if (existing.state === "completed") {
        return {
          status: "replay" as const,
          record: existing,
        };
      }

      return {
        status: "in_progress" as const,
        record: existing,
      };
    }

    if (existing) {
      await ctx.db.patch(existing._id, pendingRecord);
      const record = await ctx.db.get(existing._id);
      if (!record) {
        throw new Error("Idempotency record missing after patch");
      }
      return {
        status: "started" as const,
        record,
      };
    }

    const recordId = await ctx.db.insert("apiIdempotencyKeys", {
      ...pendingRecord,
      createdAt: now,
    });

    const record = await ctx.db.get(recordId);
    if (!record) {
      throw new Error("Idempotency record missing after insert");
    }

    return {
      status: "started" as const,
      record,
    };
  },
});

export const completeIdempotencyRequestForUser = internalMutation({
  args: {
    ...idempotencyReferenceArgs,
    ...ttlArg,
    requestHash: v.string(),
    responseStatus: v.number(),
    responseBody: v.any(),
  },
  returns: idempotencyRecordValidator,
  handler: async (ctx, args) => {
    const existing = await getRecordForUser(ctx, args);
    if (!existing || existing.requestHash !== args.requestHash) {
      throw new Error("Idempotency reservation not found");
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      state: "completed",
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      expiresAt: now + getTtlMs(args.ttlMs),
      updatedAt: now,
    });

    const updated = await ctx.db.get(existing._id);
    if (!updated) {
      throw new Error("Idempotency record missing after completion");
    }
    return updated;
  },
});

export const releaseIdempotencyRequestForUser = internalMutation({
  args: {
    ...idempotencyReferenceArgs,
    requestHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await getRecordForUser(ctx, args);
    if (
      !existing ||
      existing.requestHash !== args.requestHash ||
      existing.state !== "pending"
    ) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return null;
  },
});
