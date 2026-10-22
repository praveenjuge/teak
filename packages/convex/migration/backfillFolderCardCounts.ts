import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { insertFolderCardCountBase } from "../folder/folderRows";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const totalsValidator = v.object({
  examined: v.number(),
  foldersToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Copies each folder's stored `activeCardCount` into its `folderCardCounts`
 * base row. Card writes no longer change the stored count, so the copy is
 * exact whenever it runs; folders made since the table existed already have
 * one.
 */
export const backfillFolderCardCounts = internalMutation({
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
      .query("folders")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = {
      examined: 0,
      foldersToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const folder of page.page) {
      batch.examined += 1;
      const base = await ctx.db
        .query("folderCardCounts")
        .withIndex("by_folderId_and_shard", (q) =>
          q.eq("folderId", folder._id).eq("shard", 0)
        )
        .unique();
      if (base) {
        continue;
      }
      if (await accountDeleting(folder.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.foldersToUpdate += 1;
      if (!dryRun) {
        await insertFolderCardCountBase(ctx, folder);
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      foldersToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      foldersToUpdate: previous.foldersToUpdate + batch.foldersToUpdate,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillFolderCardCounts"].backfillFolderCardCounts,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("backfillFolderCardCounts finished", { dryRun, ...totals });
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
