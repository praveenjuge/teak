import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** A deleted card's last link check (card/linkCheck.ts). */
export const deleteLinkCheckRows = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<void> => {
  const row = await ctx.db
    .query("linkChecks")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();
  if (row) {
    await ctx.db.delete("linkChecks", row._id);
  }
};
