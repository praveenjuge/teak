import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_HIGHLIGHTS_PER_CARD } from "../shared/highlights/constants";

/** Removes every highlight of a card that is gone. */
export const deleteCardHighlightRows = async (
  ctx: Pick<MutationCtx, "db">,
  cardId: Id<"cards">
): Promise<void> => {
  const rows = await ctx.db
    .query("highlights")
    .withIndex("by_cardId_and_createdAt", (q) => q.eq("cardId", cardId))
    .take(MAX_HIGHLIGHTS_PER_CARD * 2);
  for (const row of rows) {
    await ctx.db.delete("highlights", row._id);
  }
};
