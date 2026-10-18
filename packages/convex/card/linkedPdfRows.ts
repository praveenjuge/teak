import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { queueObjectDeletion } from "../storage/r2";

export const deleteLinkedPdfRowsAsLink = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<void> => {
  const row = await ctx.db
    .query("linkedPdfs")
    .withIndex("by_sourceCardId", (q) => q.eq("sourceCardId", cardId))
    .unique();
  if (!row) {
    return;
  }
  if (row.status !== "done") {
    await queueObjectDeletion(ctx, row.fileKey);
  }
  await ctx.db.delete("linkedPdfs", row._id);
};

export const deleteLinkedPdfRowsAsDocument = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<void> => {
  const row = await ctx.db
    .query("linkedPdfs")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();
  if (row) {
    await ctx.db.delete("linkedPdfs", row._id);
  }
};
