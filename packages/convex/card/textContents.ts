import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Removes a card's text row; the R2 object goes with the card's keys. */
export const deleteCardTextContents = async (
  ctx: Pick<MutationCtx, "db">,
  cardId: Id<"cards">
): Promise<void> => {
  const row = await ctx.db
    .query("cardTextContents")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .unique();
  if (row) {
    await ctx.db.delete("cardTextContents", row._id);
  }
};
