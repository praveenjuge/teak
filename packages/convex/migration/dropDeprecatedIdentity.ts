import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";

// One-off clear of Teak's retired WorkOS identity copies, so the next deploy
// can drop them from the schema. The WorkOS AuthKit component holds the
// profile now. Take an encrypted snapshot first. Start it with
// `bunx convex run migration/dropDeprecatedIdentity:run '{}'`; each batch
// schedules the next, and `remaining` reports what is left.

const BATCH = 100;
const TABLES = [
  "workosProfiles",
  "workosReconciliationCursors",
  "workosReconciliationRuns",
  "workosImportLeases",
  "e2eSignupReservations",
] as const;

const deleteBatch = async (
  ctx: MutationCtx,
  table: (typeof TABLES)[number]
) => {
  const rows = await ctx.db.query(table).take(BATCH);
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
  }
  return rows.length;
};

export const run = internalMutation({
  args: {
    stage: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { stage = 0, cursor = null }) => {
    const table = TABLES[stage];
    if (table) {
      const deleted = await deleteBatch(ctx, table);
      await ctx.scheduler.runAfter(
        0,
        internal.migration.dropDeprecatedIdentity.run,
        { stage: deleted < BATCH ? stage + 1 : stage }
      );
      return null;
    }
    // Last stage: the retired profile fields on users.
    const result = await ctx.db
      .query("users")
      .paginate({ cursor, numItems: BATCH });
    for (const owner of result.page) {
      if (
        owner.workosEmail !== undefined ||
        owner.workosEmailVerified !== undefined ||
        owner.lastWorkosEventAt !== undefined
      ) {
        await ctx.db.patch("users", owner._id, {
          workosEmail: undefined,
          workosEmailVerified: undefined,
          lastWorkosEventAt: undefined,
        });
      }
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migration.dropDeprecatedIdentity.run,
        { stage, cursor: result.continueCursor }
      );
    }
    return null;
  },
});

export const remaining = internalQuery({
  args: {},
  returns: v.record(v.string(), v.number()),
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      counts[table] = (await ctx.db.query(table).take(1000)).length;
    }
    let users = 0;
    for (const owner of await ctx.db.query("users").take(10_000)) {
      if (
        owner.workosEmail !== undefined ||
        owner.workosEmailVerified !== undefined ||
        owner.lastWorkosEventAt !== undefined
      ) {
        users += 1;
      }
    }
    counts.usersWithRetiredFields = users;
    return counts;
  },
});
