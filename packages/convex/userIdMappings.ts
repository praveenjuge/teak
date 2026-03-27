import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";

const migrationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("completed")
);

const mappingStatsValidator = v.object({
  total: v.number(),
  pending: v.number(),
  active: v.number(),
  completed: v.number(),
});

const backfillResultValidator = v.object({
  created: v.number(),
  updated: v.number(),
  skipped: v.number(),
  nextCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

type MappingDoc = Doc<"userIdMappings">;

export const getMappingByClerkIdInDb = async (
  ctx: any,
  clerkId: string
): Promise<MappingDoc | null> => {
  return getFirstMappingByIndex(ctx, "by_clerk_id", "clerkId", clerkId);
};

const getFirstMappingByIndex = async (
  ctx: any,
  indexName: "by_better_auth_id" | "by_clerk_id" | "by_email",
  fieldName: "betterAuthId" | "clerkId" | "email",
  value: string
): Promise<MappingDoc | null> => {
  const results = await ctx.db
    .query("userIdMappings")
    .withIndex(indexName, (q: any) => q.eq(fieldName, value))
    .take(1);

  return results[0] ?? null;
};

export const upsertBetterAuthMappingInDb = async (
  ctx: any,
  args: { betterAuthId: string; email: string }
) => {
  const now = Date.now();
  const existingByBetterAuthId = await getFirstMappingByIndex(
    ctx,
    "by_better_auth_id",
    "betterAuthId",
    args.betterAuthId
  );

  if (existingByBetterAuthId) {
    const nextStatus = existingByBetterAuthId.clerkId ? "active" : "pending";
    await ctx.db.patch("userIdMappings", existingByBetterAuthId._id, {
      betterAuthId: args.betterAuthId,
      email: args.email,
      migrationStatus: nextStatus,
      mappedAt:
        nextStatus === "active"
          ? (existingByBetterAuthId.mappedAt ?? now)
          : existingByBetterAuthId.mappedAt,
      updatedAt: now,
    });
    return { action: "updated" as const, id: existingByBetterAuthId._id };
  }

  const existingByEmail = await getFirstMappingByIndex(
    ctx,
    "by_email",
    "email",
    args.email
  );

  if (existingByEmail) {
    const nextStatus = existingByEmail.clerkId ? "active" : "pending";
    await ctx.db.patch("userIdMappings", existingByEmail._id, {
      betterAuthId: args.betterAuthId,
      email: args.email,
      migrationStatus: nextStatus,
      mappedAt:
        nextStatus === "active"
          ? (existingByEmail.mappedAt ?? now)
          : existingByEmail.mappedAt,
      updatedAt: now,
    });
    return { action: "updated" as const, id: existingByEmail._id };
  }

  const id = await ctx.db.insert("userIdMappings", {
    betterAuthId: args.betterAuthId,
    clerkId: undefined,
    email: args.email,
    migrationStatus: "pending",
    createdAt: now,
    updatedAt: now,
    mappedAt: undefined,
  });

  return { action: "created" as const, id };
};

export const upsertClerkMappingInDb = async (
  ctx: any,
  args: { clerkId: string; email: string }
) => {
  const now = Date.now();
  const existingByClerkId = await getFirstMappingByIndex(
    ctx,
    "by_clerk_id",
    "clerkId",
    args.clerkId
  );

  if (existingByClerkId) {
    const nextStatus = existingByClerkId.betterAuthId ? "active" : "pending";
    await ctx.db.patch("userIdMappings", existingByClerkId._id, {
      clerkId: args.clerkId,
      email: args.email,
      migrationStatus: nextStatus,
      mappedAt:
        nextStatus === "active"
          ? (existingByClerkId.mappedAt ?? now)
          : existingByClerkId.mappedAt,
      updatedAt: now,
    });
    return { action: "updated" as const, id: existingByClerkId._id };
  }

  const existingByEmail = await getFirstMappingByIndex(
    ctx,
    "by_email",
    "email",
    args.email
  );

  if (existingByEmail) {
    const nextStatus = existingByEmail.betterAuthId ? "active" : "pending";
    await ctx.db.patch("userIdMappings", existingByEmail._id, {
      clerkId: args.clerkId,
      email: args.email,
      migrationStatus: nextStatus,
      mappedAt: now,
      updatedAt: now,
    });
    return { action: "updated" as const, id: existingByEmail._id };
  }

  const id = await ctx.db.insert("userIdMappings", {
    betterAuthId: undefined,
    clerkId: args.clerkId,
    email: args.email,
    migrationStatus: "pending",
    createdAt: now,
    updatedAt: now,
    mappedAt: undefined,
  });

  return { action: "created" as const, id };
};

export const upsertBetterAuthMapping = internalMutation({
  args: {
    betterAuthId: v.string(),
    email: v.string(),
  },
  returns: v.object({
    action: v.union(v.literal("created"), v.literal("updated")),
    id: v.id("userIdMappings"),
  }),
  handler: async (ctx, args) => upsertBetterAuthMappingInDb(ctx, args),
});

export const upsertClerkMapping = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
  },
  returns: v.object({
    action: v.union(v.literal("created"), v.literal("updated")),
    id: v.id("userIdMappings"),
  }),
  handler: async (ctx, args) => upsertClerkMappingInDb(ctx, args),
});

export const resolveClerkToBetterAuthId = internalQuery({
  args: {
    clerkId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const mapping = await getMappingByClerkIdInDb(ctx, args.clerkId);
    return mapping?.betterAuthId ?? null;
  },
});

export const getMappingStats = query({
  args: {},
  returns: mappingStatsValidator,
  handler: async (ctx) => {
    const mappings = await ctx.db.query("userIdMappings").collect();
    return mappings.reduce(
      (acc, mapping) => {
        acc.total += 1;
        if (mapping.migrationStatus === "pending") {
          acc.pending += 1;
        } else if (mapping.migrationStatus === "active") {
          acc.active += 1;
        } else if (mapping.migrationStatus === "completed") {
          acc.completed += 1;
        }
        return acc;
      },
      { total: 0, pending: 0, active: 0, completed: 0 }
    );
  },
});

export const listMappingsByStatus = query({
  args: {
    status: migrationStatusValidator,
  },
  returns: v.array(
    v.object({
      id: v.id("userIdMappings"),
      betterAuthId: v.optional(v.string()),
      clerkId: v.optional(v.string()),
      email: v.string(),
      migrationStatus: migrationStatusValidator,
      createdAt: v.number(),
      updatedAt: v.number(),
      mappedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const mappings = await ctx.db
      .query("userIdMappings")
      .withIndex("by_migration_status", (q) =>
        q.eq("migrationStatus", args.status)
      )
      .collect();

    return mappings.map((mapping) => ({
      id: mapping._id,
      betterAuthId: mapping.betterAuthId,
      clerkId: mapping.clerkId,
      email: mapping.email,
      migrationStatus: mapping.migrationStatus,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      mappedAt: mapping.mappedAt,
    }));
  },
});

export const backfillBetterAuthUserMappingsHandler = async (
  _ctx: any,
  args: {
    batchSize?: number;
    cursor?: string | null;
  }
) => {
  return {
    created: 0,
    updated: 0,
    skipped: args.batchSize ?? 0,
    nextCursor: args.cursor ?? null,
    isDone: true,
  };
};

export const backfillBetterAuthUserMappings = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: backfillResultValidator,
  handler: backfillBetterAuthUserMappingsHandler,
});
