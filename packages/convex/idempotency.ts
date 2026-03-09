import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

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

type IdempotencyReference = {
  userId: string;
  keyHash: string;
};

const ttlArg = {
  ttlMs: v.optional(v.number()),
} as const;

const getTtlMs = (ttlMs?: number): number =>
  typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : 24 * 60 * 60 * 1000;

const getRecordForUser = async (
  ctx: MutationCtx,
  args: IdempotencyReference
) => {
  return ctx.db
    .query("apiIdempotencyKeys")
    .withIndex("by_user_key_hash", (query) =>
      query.eq("userId", args.userId).eq("keyHash", args.keyHash)
    )
    .first();
};

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
    const ttlMs = getTtlMs(args.ttlMs);
    const expiresAt = now + ttlMs;
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
      return {
        status: "started" as const,
        record: (await ctx.db.get(existing._id))!,
      };
    }

    const recordId = await ctx.db.insert("apiIdempotencyKeys", {
      ...pendingRecord,
      createdAt: now,
    });

    return {
      status: "started" as const,
      record: (await ctx.db.get(recordId))!,
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

    return (await ctx.db.get(existing._id))!;
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
