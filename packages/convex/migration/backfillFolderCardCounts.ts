import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import { insertFolderCardCountBase } from "../folder/folderRows";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

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
  args: backfillArgs(totalsValidator),
  returns: backfillReturns(totalsValidator),
  handler: (ctx, args) =>
    runBackfillPage(ctx, args, {
      empty: () => ({
        examined: 0,
        foldersToUpdate: 0,
        skippedDeletingAccounts: 0,
      }),
      name: "backfillFolderCardCounts",
      read: (cursor, numItems) =>
        ctx.db.query("folders").paginate({ cursor, numItems }),
      self: internal["migration/backfillFolderCardCounts"]
        .backfillFolderCardCounts,
      visit: async (folders, batch, dryRun) => {
        const accountDeleting = createAccountDeletionGate(ctx);
        for (const folder of folders) {
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
      },
    }),
});
