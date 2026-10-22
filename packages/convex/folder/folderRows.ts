import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_FOLDERS_PER_CARD } from "../shared/folders";

/**
 * A folder's active card count lives in `folderCardCounts`, off the folder
 * document that every folder list reads. Shard 0 is the base count; card
 * writes add their changes to one of the other shards, picked by card, so
 * writers to one folder rarely touch the same row. A folder without a base
 * row (created before the table) starts from its stored `activeCardCount`
 * until `migration/backfillFolderCardCounts` copies it.
 */
export const FOLDER_CARD_COUNT_SHARDS = 4;

const folderCardCountRows = (
  ctx: Pick<QueryCtx, "db">,
  folderId: Id<"folders">
) =>
  ctx.db
    .query("folderCardCounts")
    .withIndex("by_folderId_and_shard", (q) => q.eq("folderId", folderId))
    .take(FOLDER_CARD_COUNT_SHARDS + 1);

export const readFolderCardCount = async (
  ctx: Pick<QueryCtx, "db">,
  folder: Doc<"folders">
): Promise<number> => {
  const rows = await folderCardCountRows(ctx, folder._id);
  const base = rows.some((row) => row.shard === 0) ? 0 : folder.activeCardCount;
  return Math.max(
    0,
    rows.reduce((sum, row) => sum + row.count, base)
  );
};

export const insertFolderCardCountBase = (
  ctx: MutationCtx,
  folder: Pick<Doc<"folders">, "_id" | "activeCardCount" | "userId">
) =>
  ctx.db.insert("folderCardCounts", {
    folderId: folder._id,
    userId: folder.userId,
    shard: 0,
    count: folder.activeCardCount,
  });

export const deleteFolderCardCounts = async (
  ctx: MutationCtx,
  folderId: Id<"folders">
) => {
  for (const row of await folderCardCountRows(ctx, folderId)) {
    await ctx.db.delete("folderCardCounts", row._id);
  }
};

const cardCountShard = (cardId: Id<"cards">) => {
  let hash = 0;
  for (const character of cardId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }
  return 1 + (hash % FOLDER_CARD_COUNT_SHARDS);
};

const addFolderCardCount = async (
  ctx: MutationCtx,
  folderId: Id<"folders">,
  cardId: Id<"cards">,
  delta: number
) => {
  const shard = cardCountShard(cardId);
  const row = await ctx.db
    .query("folderCardCounts")
    .withIndex("by_folderId_and_shard", (q) =>
      q.eq("folderId", folderId).eq("shard", shard)
    )
    .unique();
  if (row) {
    await ctx.db.patch("folderCardCounts", row._id, {
      count: row.count + delta,
    });
    return;
  }
  const folder = await ctx.db.get("folders", folderId);
  if (folder) {
    await ctx.db.insert("folderCardCounts", {
      folderId,
      userId: folder.userId,
      shard,
      count: delta,
    });
  }
};

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

const isActiveRow = (row: Pick<FolderCardFields, "isArchived" | "isDeleted">) =>
  row.isDeleted !== true && row.isArchived !== true;

const hasFolders = (card: Pick<Doc<"cards">, "folderIds">) =>
  (card.folderIds?.length ?? 0) > 0;

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

export const deletedCardMayHaveFolderRows = (
  previous: Doc<"cards"> | undefined
) => !previous || hasFolders(previous);

export const syncCardFolderRows = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  card: Doc<"cards"> | null
) => {
  const existingRows = await ctx.db
    .query("folderCards")
    .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", cardId))
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
    if (delta !== 0) {
      await addFolderCardCount(ctx, folderId, cardId, delta);
    }
  }
};
