import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_FOLDERS_PER_CARD } from "../shared/folders";

type FolderCardFields = Pick<
  Doc<"folderCards">,
  "isArchived" | "isDeleted" | "type" | "cardCreatedAt"
>;

const rowFieldsForCard = (card: Doc<"cards">): FolderCardFields => ({
  isDeleted: card.isDeleted === true ? true : undefined,
  isArchived: card.isArchived === true ? true : undefined,
  type: card.type,
  cardCreatedAt: card.createdAt,
});

/** A row counts toward its folder's activeCardCount when it is in neither. */
const isActiveRow = (row: Pick<FolderCardFields, "isArchived" | "isDeleted">) =>
  row.isDeleted !== true && row.isArchived !== true;

const hasFolders = (card: Pick<Doc<"cards">, "folderIds">) =>
  (card.folderIds?.length ?? 0) > 0;

/**
 * Whether a card change can move its folderCards rows: membership, Trash,
 * Archive, type or saved date. A card in no folder, before or after, has no
 * rows, and text-only edits leave them alone, so neither reads folder rows.
 * Without a pre-change card (a new card, or a direct repair) only a card
 * with folders is synced.
 */
export const cardFolderRowsMayChange = (
  previous: Doc<"cards"> | undefined,
  card: Doc<"cards">
) => {
  if (!previous) {
    return hasFolders(card);
  }
  if (!(hasFolders(previous) || hasFolders(card))) {
    return false;
  }
  return (
    JSON.stringify(previous.folderIds ?? []) !==
      JSON.stringify(card.folderIds ?? []) ||
    (previous.isDeleted === true) !== (card.isDeleted === true) ||
    (previous.isArchived === true) !== (card.isArchived === true) ||
    previous.type !== card.type ||
    previous.createdAt !== card.createdAt
  );
};

/**
 * Whether a hard-deleted card can have left folder rows: always, unless the
 * caller passed the deleted card and it was in no folder.
 */
export const deletedCardMayHaveFolderRows = (
  previous: Doc<"cards"> | undefined
) => !previous || hasFolders(previous);

/**
 * Brings the card's folderCards rows in line with `card.folderIds` and its
 * Trash, Archive, type and date, and keeps each folder's activeCardCount in
 * step. A missing card (hard delete) removes every row. Rows are only written
 * where they differ, and a folder that no longer exists gets no row.
 */
export const syncCardFolderRows = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  card: Doc<"cards"> | null
) => {
  const existingRows = await ctx.db
    .query("folderCards")
    .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", cardId))
    // A card holds at most MAX_FOLDERS_PER_CARD folders; the margin covers
    // rows a previous, larger membership left behind.
    .take(MAX_FOLDERS_PER_CARD * 2);
  const wanted = new Set<Id<"folders">>(card ? (card.folderIds ?? []) : []);
  const countDeltas = new Map<Id<"folders">, number>();
  const adjust = (folderId: Id<"folders">, delta: number) => {
    if (delta !== 0) {
      countDeltas.set(folderId, (countDeltas.get(folderId) ?? 0) + delta);
    }
  };

  const seen = new Set<Id<"folders">>();
  for (const row of existingRows) {
    if (!(card && wanted.has(row.folderId)) || seen.has(row.folderId)) {
      await ctx.db.delete("folderCards", row._id);
      if (isActiveRow(row)) {
        adjust(row.folderId, -1);
      }
      continue;
    }
    seen.add(row.folderId);
    const fields = rowFieldsForCard(card);
    if (
      row.isDeleted !== fields.isDeleted ||
      row.isArchived !== fields.isArchived ||
      row.type !== fields.type ||
      row.cardCreatedAt !== fields.cardCreatedAt
    ) {
      await ctx.db.patch("folderCards", row._id, fields);
      adjust(
        row.folderId,
        Number(isActiveRow(fields)) - Number(isActiveRow(row))
      );
    }
  }

  if (card) {
    const fields = rowFieldsForCard(card);
    for (const folderId of wanted) {
      if (seen.has(folderId)) {
        continue;
      }
      const folder = await ctx.db.get("folders", folderId);
      if (!folder || folder.userId !== card.userId) {
        continue;
      }
      await ctx.db.insert("folderCards", {
        folderId,
        cardId,
        userId: card.userId,
        ...fields,
        addedAt: Date.now(),
      });
      if (isActiveRow(fields)) {
        adjust(folderId, 1);
      }
    }
  }

  for (const [folderId, delta] of countDeltas) {
    const folder = await ctx.db.get("folders", folderId);
    if (folder) {
      await ctx.db.patch("folders", folderId, {
        activeCardCount: Math.max(0, folder.activeCardCount + delta),
      });
    }
  }
};
