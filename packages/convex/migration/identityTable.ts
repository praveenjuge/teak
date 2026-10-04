import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { env, internalMutation, internalQuery } from "../_generated/server";
import { readSignupsDisabled } from "../env";
import {
  type BetterAuthUserSource,
  mirrorBetterAuthUser,
  normalizeIdentityEmail,
} from "../userIdentityTable";

const assertBetterAuthMigration = () => {
  if (
    !readSignupsDisabled() ||
    (env.AUTH_PRIMARY !== undefined && env.AUTH_PRIMARY !== "betterauth")
  ) {
    throw new Error("Identity backfill requires frozen Better Auth sign-ups");
  }
};

export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    processed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor }) => {
    assertBetterAuthMigration();
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { cursor, numItems: 100 },
    });
    for (const user of result.page as BetterAuthUserSource[]) {
      await mirrorBetterAuthUser(ctx, user);
    }
    return {
      processed: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Scan both directions with bounded pages. Deleted mirrors intentionally have
// no provider row, so report their count separately from orphaned active rows.
export const coveragePage = internalQuery({
  args: {
    direction: v.union(v.literal("betterauth"), v.literal("users")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    scanned: v.number(),
    missing: v.number(),
    mismatched: v.number(),
    tombstones: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { direction, paginationOpts }) => {
    const options = {
      ...paginationOpts,
      numItems: Math.min(100, Math.max(1, paginationOpts.numItems)),
    };
    let missing = 0;
    let mismatched = 0;
    let tombstones = 0;
    if (direction === "betterauth") {
      const result = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        { model: "user", paginationOpts: options }
      );
      for (const user of result.page as BetterAuthUserSource[]) {
        const row = await ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", user._id))
          .unique();
        if (!row) {
          missing += 1;
        } else if (
          row.deletedAt !== undefined ||
          row.email !== normalizeIdentityEmail(user.email) ||
          row.emailVerified !== user.emailVerified
        ) {
          mismatched += 1;
        }
      }
      return {
        scanned: result.page.length,
        missing,
        mismatched,
        tombstones,
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    const result = await ctx.db.query("users").paginate(options);
    for (const row of result.page) {
      if (row.deletedAt !== undefined) {
        tombstones += 1;
        continue;
      }
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: row.teakUserId }],
      })) as BetterAuthUserSource | null;
      if (!user) {
        missing += 1;
      } else if (
        row.email !== normalizeIdentityEmail(user.email) ||
        row.emailVerified !== user.emailVerified
      ) {
        mismatched += 1;
      }
    }
    return {
      scanned: result.page.length,
      missing,
      mismatched,
      tombstones,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Run once before changing admin authorization to the stable role. Keep the
// existing email contract until both deployments have verified this seed.
export const seedAdmin = internalMutation({
  args: {},
  returns: v.object({ teakUserId: v.string(), role: v.literal("admin") }),
  handler: async (ctx) => {
    assertBetterAuthMigration();
    const email = normalizeIdentityEmail(env.TEAK_ADMIN_EMAIL ?? "");
    if (!email) {
      throw new Error("The existing admin email is not configured");
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (rows.length !== 1 || rows[0].deletedAt !== undefined) {
      throw new Error("Admin seed requires exactly one active mapped account");
    }
    await ctx.db.patch("users", rows[0]._id, { role: "admin" });
    return { teakUserId: rows[0].teakUserId, role: "admin" as const };
  },
});
