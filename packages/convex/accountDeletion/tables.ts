import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteFolderCardCounts } from "../folder/folderRows";

/**
 * Every table that holds a user's rows, and what account deletion does with
 * them. `__tests__/accountDeletion/tables.test.ts` fails when a schema table
 * with a user key is in none of these lists, or in more than one, so a new
 * table can't be left behind by a deletion by accident.
 */

export interface SweptTable {
  /** Called on each row before it is deleted. */
  beforeDelete?: (ctx: MutationCtx, id: Id<TableNames>) => Promise<void>;
  /** An index whose first field is `key`. */
  index: string;
  /** The field that holds the Teak user ID. */
  key: "teakUserId" | "userId";
  /** Rows one page deletes. */
  page: number;
  table: TableNames;
}

/**
 * Emptied by `accountDeletionData:ancillaryPage`, a page of each at a time,
 * once the account's cards and stored objects are gone.
 */
export const SWEPT_TABLES: readonly SweptTable[] = [
  {
    table: "apiIdempotencyKeys",
    index: "by_user_key_hash",
    key: "userId",
    page: 100,
  },
  {
    table: "cardTombstones",
    index: "by_userId_and_deletedAt",
    key: "userId",
    page: 100,
  },
  { table: "folderCards", index: "by_userId", key: "userId", page: 100 },
  {
    table: "folders",
    index: "by_userId_and_createdAt",
    key: "userId",
    page: 100,
    beforeDelete: (ctx, id) => deleteFolderCardCounts(ctx, id as Id<"folders">),
  },
  {
    table: "folderRuleApplications",
    index: "by_userId",
    key: "userId",
    page: 100,
  },
  {
    table: "folderRuleRunChanges",
    index: "by_userId",
    key: "userId",
    page: 100,
  },
  { table: "folderRuleRuns", index: "by_userId", key: "userId", page: 100 },
  { table: "userTagSummaries", index: "by_userId", key: "userId", page: 10 },
  { table: "tagSummaryRefreshes", index: "by_userId", key: "userId", page: 10 },
  {
    table: "userTagCounts",
    index: "by_userId_and_tag",
    key: "userId",
    page: 100,
  },
  { table: "tagCountDeltas", index: "by_userId", key: "userId", page: 100 },
  {
    table: "tagOperations",
    index: "by_userId_and_createdAt",
    key: "userId",
    page: 100,
  },
  { table: "vaultSetups", index: "by_userId", key: "userId", page: 10 },
  { table: "vectorShards", index: "by_userId", key: "userId", page: 10 },
  {
    table: "semanticSearchResults",
    index: "by_userId_and_key",
    key: "userId",
    page: 100,
  },
  {
    table: "searchRelevanceResults",
    index: "by_userId_and_key",
    key: "userId",
    page: 100,
  },
  { table: "linkedPdfs", index: "by_userId", key: "userId", page: 100 },
  {
    table: "inboundEmailSettings",
    index: "by_userId",
    key: "userId",
    page: 10,
  },
  {
    table: "inboundEmailReceipts",
    index: "by_userId",
    key: "userId",
    page: 100,
  },
  { table: "userPreferences", index: "by_userId", key: "userId", page: 10 },
  { table: "cardLinks", index: "by_userId", key: "userId", page: 100 },
  { table: "linkChecks", index: "by_userId", key: "userId", page: 100 },
  { table: "highlights", index: "by_userId", key: "userId", page: 100 },
  { table: "linkPasteJobs", index: "by_user_status", key: "userId", page: 100 },
  {
    table: "aiUsageDaily",
    index: "by_userId_and_date",
    key: "userId",
    page: 100,
  },
  // Whether the account counts as internal and may use AI: a deleted
  // account's ID is never signed in to again, so nothing is left to flag.
  {
    table: "adminUserFlags",
    index: "by_teakUserId",
    key: "teakUserId",
    page: 10,
  },
];

/** Deleted by another step of the deletion, which says where. */
export const DELETED_BY_OTHER_STEPS: Partial<Record<TableNames, string>> = {
  accountDeletionStates: "`accountDeletionJobs:finalize`, last of all",
  accountStorageObjects: "the storage batches (`accountDeletion/batch.ts`)",
  apiKeyAuthCache:
    "each API key's cached sign-ins, when the first stage revokes the key",
  cardEmbeddings: "the vector purge (`embedding/state.ts`)",
  cardSearchDocuments: "with each card (`deleteAccountDataHandler`)",
  cardSearchTagSyncStates: "with each card (`deleteAccountDataHandler`)",
  cardSearchTags: "with each card (`deleteAccountDataHandler`)",
  cardTextContents: "with each card (`deleteAccountDataHandler`)",
  cards: "the storage batches, with their files",
  exportJobItems: "the storage batches (`accountDeletion/batch.ts`)",
  exportJobs: "the storage batches, with their artifacts",
  fileUploadSessions: "the storage batches, with their uploads",
  folderCardCounts: "with each folder, in the sweep above",
  importJobItems: "the storage batches (`accountDeletion/batch.ts`)",
  importJobs: "the storage batches, with their staged parts",
  userCardUsage: "the card usage step (`removeAccountCardUsage`)",
  userCardUsageShards: "the card usage step (`removeAccountCardUsage`)",
};

/** Kept on purpose, and why. */
export const KEPT_TABLES: Partial<Record<TableNames, string>> = {
  adminAuditLog:
    "What an admin did and to whom: the operator's record outlives the account.",
  users:
    "The account's ID and deletion date, with the name and (for non-WorkOS sign-ins) the email cleared by `finalize`.",
  workosConsents:
    "Marked revoked in the first stage, so a token issued before the deletion is refused; the row is that refusal.",
};

/**
 * Deletes one page of the user's rows in a swept table, and returns how
 * many it deleted. The table and index are only known at run time here;
 * `__tests__/accountDeletion/tables.test.ts` checks that each index starts
 * with its key.
 */
export const sweepAccountRows = async (
  ctx: MutationCtx,
  { beforeDelete, index, key, page, table }: SweptTable,
  userId: string
): Promise<number> => {
  const rows = await ctx.db
    .query(table)
    .withIndex(index as never, (q) =>
      (q as unknown as { eq: (field: string, value: string) => never }).eq(
        key,
        userId
      )
    )
    .take(page);
  for (const row of rows) {
    await beforeDelete?.(ctx, row._id);
    await ctx.db.delete(row._id);
  }
  return rows.length;
};
