import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

// One-off: clears what the WorkOS migration left in the database, so the next
// deploy can drop these tables and fields from the schema. Run each table until
// `isDone`, first as a dry run, then with `dryRun: false`:
// `convex run migration/clearWorkosLeftovers:clear '{"table":"users","dryRun":false}'`
const BATCH_SIZE = 100;

const RETIRED_FIELDS = {
  users: ["workosDeletionCompletion"],
  accountDeletionStates: ["workosTarget", "deletionReceiptCursor"],
  workosConsents: ["recoveryReceipt"],
} as const;

export const clear = internalMutation({
  args: {
    table: v.union(
      v.literal("users"),
      v.literal("accountDeletionStates"),
      v.literal("workosConsents"),
      v.literal("migrationQuarantine"),
      v.literal("workosApplicationDisconnects")
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    examined: v.number(),
    changed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { table, cursor, dryRun = true }) => {
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
    let changed = 0;
    for (const row of page.page) {
      if (
        table === "migrationQuarantine" ||
        table === "workosApplicationDisconnects"
      ) {
        changed += 1;
        if (!dryRun) {
          await ctx.db.delete(table, row._id as Id<typeof table>);
        }
        continue;
      }
      const present = RETIRED_FIELDS[table].filter(
        (field) => (row as Record<string, unknown>)[field] !== undefined
      );
      if (present.length === 0) {
        continue;
      }
      changed += 1;
      if (!dryRun) {
        await ctx.db.patch(
          table,
          row._id as Id<typeof table>,
          Object.fromEntries(present.map((field) => [field, undefined]))
        );
      }
    }
    return {
      dryRun,
      examined: page.page.length,
      changed,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
