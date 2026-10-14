import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// cardTextContents rows (card/documentText.ts), read by the search sync and
// removed with their card. Kept apart so the sync needs nothing else here.

/** The searchable prefix of a card's extracted text, for its search text. */
export const readSearchPrefix = async (
  ctx: Pick<MutationCtx, "db">,
  card: Pick<Doc<"cards">, "_id" | "hasExtractedText">
): Promise<string | undefined> => {
  if (!card.hasExtractedText) {
    return;
  }
  const row = await ctx.db
    .query("cardTextContents")
    .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
    .unique();
  return row?.text;
};

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
