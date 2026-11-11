import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * The tables that cache one user's search results for a while, keyed by a
 * hash of the search: the meaning ranking and the relevance scores. Both have
 * `userId`, `key` and `expiresAt`, with the same two indexes.
 */
export type SearchCacheTable =
  | "searchRelevanceResults"
  | "semanticSearchResults";

const CLEANUP_BATCH = 500;

// The two tables share their index names and indexed fields, so one of them
// stands in for both in the query builder's types.
const cacheQuery = (ctx: Pick<QueryCtx, "db">, table: SearchCacheTable) =>
  ctx.db.query(table as "semanticSearchResults");

export const findCachedResult = async <T extends SearchCacheTable>(
  ctx: Pick<QueryCtx, "db">,
  table: T,
  userId: string,
  key: string
): Promise<Doc<T> | null> =>
  (await cacheQuery(ctx, table)
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", userId).eq("key", key)
    )
    .first()) as Doc<T> | null;

export const writeCachedResult = async <T extends SearchCacheTable>(
  ctx: Pick<MutationCtx, "db">,
  table: T,
  existing: Doc<T> | null,
  row: Omit<Doc<T>, "_creationTime" | "_id">
) => {
  if (existing) {
    await ctx.db.replace(table, existing._id as Id<T>, row as never);
  } else {
    await ctx.db.insert(table, row as never);
  }
};

/** Deletes a batch of expired rows; the cron runs again while `hasMore`. */
export const deleteExpiredResults = async (
  ctx: Pick<MutationCtx, "db">,
  table: SearchCacheTable
) => {
  const expired = await cacheQuery(ctx, table)
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
    .take(CLEANUP_BATCH);
  for (const entry of expired) {
    await ctx.db.delete(table, entry._id as Id<SearchCacheTable>);
  }
  return {
    deleted: expired.length,
    hasMore: expired.length === CLEANUP_BATCH,
  };
};
