import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { deleteCardTextRows } from "../card/textContents";
import { deleteCardFolderRuleRows } from "../folder/rules";
import { MAX_FOLDERS_PER_CARD } from "../shared/folders";

const ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE = 20;

export declare const ownerIndexBrand: unique symbol;

export type OwnedCardIds = Id<"cards">[] & {
  readonly [ownerIndexBrand]: true;
};

export const takeOwnedCards = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  limit: number,
  maxBytes = Number.POSITIVE_INFINITY
) => {
  const cards: Doc<"cards">[] = [];
  let bytes = 0;
  for await (const card of ctx.db
    .query("cards")
    .withIndex("by_user_deleted_saved", (q) => q.eq("userId", userId))) {
    bytes += JSON.stringify(card).length;
    if (cards.length > 0 && bytes > maxBytes) {
      break;
    }
    cards.push(card);
    if (cards.length >= limit) {
      break;
    }
  }
  return { cards, cardIds: cards.map((card) => card._id) as OwnedCardIds };
};

export const deleteAccountDataHandler = async (
  ctx: MutationCtx,
  cardIds: OwnedCardIds
) => {
  let deletedCards = 0;
  for (const cardId of cardIds) {
    const tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId_and_tag", (query) => query.eq("cardId", cardId))
      .take(ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE + 1);
    for (const tagDocument of tagDocuments.slice(
      0,
      ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE
    )) {
      await ctx.db.delete("cardSearchTags", tagDocument._id);
    }
    if (tagDocuments.length > ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE) {
      continue;
    }
    const searchDocument = await ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique();
    if (searchDocument) {
      await ctx.db.delete("cardSearchDocuments", searchDocument._id);
    }
    const searchTagSyncState = await ctx.db
      .query("cardSearchTagSyncStates")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique();
    if (searchTagSyncState) {
      await ctx.db.delete("cardSearchTagSyncStates", searchTagSyncState._id);
    }
    await deleteCardTextRows(ctx, cardId);
    const folderRows = await ctx.db
      .query("folderCards")
      .withIndex("by_cardId_and_folderId", (query) =>
        query.eq("cardId", cardId)
      )
      .take(MAX_FOLDERS_PER_CARD);
    for (const folderRow of folderRows) {
      await ctx.db.delete("folderCards", folderRow._id);
    }
    await deleteCardFolderRuleRows(ctx, cardId);
    try {
      await ctx.db.delete("cards", cardId);
      deletedCards += 1;
    } catch (error) {
      // Reading the card first would widen Convex's OCC read set. The
      // production backend says "Delete on nonexistent document ID ..." and
      // convex-test says "Delete on non-existent doc".
      if (
        !(
          error instanceof Error &&
          /non-?existent|not found/i.test(error.message)
        )
      ) {
        throw error;
      }
    }
  }
  return deletedCards;
};
