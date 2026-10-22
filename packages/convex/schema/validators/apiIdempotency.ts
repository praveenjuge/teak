import { v } from "convex/values";

export const apiIdempotencyKeyValidator = v.object({
  userId: v.string(),
  keyHash: v.string(),
  method: v.string(),
  path: v.string(),
  requestHash: v.string(),
  state: v.union(v.literal("pending"), v.literal("completed")),
  responseStatus: v.number(),
  responseBody: v.any(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const apiIdempotencyAnalyticsValidator = v.object({
  date: v.string(),
  endpoint: v.string(),
  shard: v.optional(v.number()),
  totalRequests: v.number(),
  withKey: v.number(),
  skipped: v.number(),
  started: v.number(),
  replayed: v.number(),
  conflicts: v.number(),
  inProgress: v.number(),
  errors: v.number(),
});
