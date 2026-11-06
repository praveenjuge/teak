import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import {
  addTagCountDelta,
  applyTagCounts,
  isCountedTagRow,
  type TagCountDeltas,
} from "../tag/tagSummary";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

const totalsValidator = v.object({
  examined: v.number(),
  rowsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Counts every exact-tag row written before `userTagCounts` existed, then
 * marks the counts ready so tag summaries stop recounting `cardSearchTags`.
 * Tag syncs keep `isCounted` current on the rows they write, so a row is
 * counted once whichever reaches it first.
 */
export const backfillTagCounts = internalMutation({
  args: backfillArgs(totalsValidator),
  returns: backfillReturns(totalsValidator),
  handler: (ctx, args) =>
    runBackfillPage(ctx, args, {
      empty: () => ({
        examined: 0,
        rowsToUpdate: 0,
        skippedDeletingAccounts: 0,
      }),
      // The last page marks the counts ready, so summaries stop recounting.
      finish: async (dryRun) => {
        if (dryRun) {
          return;
        }
        const ready = await ctx.db
          .query("tagCountStates")
          .withIndex("by_key", (q) => q.eq("key", "global"))
          .unique();
        if (!ready) {
          await ctx.db.insert("tagCountStates", {
            key: "global",
            readyAt: Date.now(),
          });
        }
      },
      name: "backfillTagCounts",
      read: (cursor, numItems) =>
        ctx.db.query("cardSearchTags").paginate({ cursor, numItems }),
      self: internal["migration/backfillTagCounts"].backfillTagCounts,
      visit: async (rows, batch, dryRun) => {
        const deltas: TagCountDeltas = new Map();
        const accountDeleting = createAccountDeletionGate(ctx);
        for (const row of rows) {
          batch.examined += 1;
          const isCounted = isCountedTagRow(row) ? (true as const) : undefined;
          if (row.isCounted === isCounted) {
            continue;
          }
          if (await accountDeleting(row.userId)) {
            batch.skippedDeletingAccounts += 1;
            continue;
          }
          batch.rowsToUpdate += 1;
          if (!dryRun) {
            await ctx.db.patch("cardSearchTags", row._id, { isCounted });
            addTagCountDelta(deltas, row.userId, row.tag, isCounted ? 1 : -1);
          }
        }
        for (const [userId, tags] of deltas) {
          await applyTagCounts(ctx, userId, tags);
        }
      },
    }),
});
