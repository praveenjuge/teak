import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import {
  addTagCountDelta,
  applyTagCounts,
  isCountedTagRow,
  type TagCountDeltas,
} from "../tag/tagSummary";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

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
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totalsValidator,
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const page = await ctx.db
      .query("cardSearchTags")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = { examined: 0, rowsToUpdate: 0, skippedDeletingAccounts: 0 };
    const deltas: TagCountDeltas = new Map();
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const row of page.page) {
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

    const previous = args.totals ?? {
      examined: 0,
      rowsToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      rowsToUpdate: previous.rowsToUpdate + batch.rowsToUpdate,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillTagCounts"].backfillTagCounts,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      if (!dryRun) {
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
      }
      console.log("backfillTagCounts finished", { dryRun, ...totals });
    }
    return {
      dryRun,
      isDone,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      batch,
      totals,
    };
  },
});
