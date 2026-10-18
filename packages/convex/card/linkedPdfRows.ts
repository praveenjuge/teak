import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteObject } from "../storage/r2";

/**
 * Removes the Save PDF rows a card hard-deleted for good took part in: as
 * the link (its PDF, if no document was made from it, goes too) or as the
 * document, so the link can be saved again.
 */
export const deleteLinkedPdfRows = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  previousCard?: Pick<Doc<"cards">, "type">
): Promise<void> => {
  if (!previousCard || previousCard.type === "link") {
    const asSource = await ctx.db
      .query("linkedPdfs")
      .withIndex("by_sourceCardId", (q) => q.eq("sourceCardId", cardId))
      .unique();
    if (asSource) {
      if (asSource.status !== "done") {
        await deleteObject(ctx, asSource.fileKey);
      }
      await ctx.db.delete("linkedPdfs", asSource._id);
    }
  }
  if (!previousCard || previousCard.type === "document") {
    const asDocument = await ctx.db
      .query("linkedPdfs")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .unique();
    if (asDocument) {
      await ctx.db.delete("linkedPdfs", asDocument._id);
    }
  }
};
