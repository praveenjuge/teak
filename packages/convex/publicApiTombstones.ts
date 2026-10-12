/**
 * Tombstones for hard-deleted cards. A permanent delete removes the card row,
 * so `/v1/cards/changes` reads these rows to report the deletion to sync
 * clients. Rows expire after CARD_TOMBSTONE_RETENTION_MS.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;
// Longer than the 30-day Trash purge, so a client that syncs at least once a
// month never misses a deletion.
export const CARD_TOMBSTONE_RETENTION_MS = 90 * DAY_MS;
const PRUNE_ON_WRITE_LIMIT = 5;
const PRUNE_BATCH_SIZE = 200;

/** Records that a card row was permanently deleted. */
export const recordCardTombstone = async (
  ctx: MutationCtx,
  args: { cardId: Id<"cards">; userId: string }
): Promise<void> => {
  const now = Date.now();
  await ctx.db.insert("cardTombstones", {
    cardId: args.cardId,
    deletedAt: now,
    userId: args.userId,
  });
  // Keep each user's tombstones bounded without a separate job: every write
  // also removes a few of that user's expired rows.
  const expired = await ctx.db
    .query("cardTombstones")
    .withIndex("by_userId_and_deletedAt", (q) =>
      q
        .eq("userId", args.userId)
        .lt("deletedAt", now - CARD_TOMBSTONE_RETENTION_MS)
    )
    .take(PRUNE_ON_WRITE_LIMIT);
  for (const row of expired) {
    await ctx.db.delete("cardTombstones", row._id);
  }
};

export interface TombstoneCursor {
  creationTime: number;
  deletedAt: number;
}

/**
 * Reads up to `limit` tombstones at or after `since`, oldest first, resuming
 * strictly after `after`. Returns one extra row's worth of `hasMore`.
 */
export const listCardTombstonesSince = async (
  ctx: QueryCtx,
  args: {
    after?: TombstoneCursor;
    limit: number;
    since: number;
    userId: string;
  }
): Promise<{
  hasMore: boolean;
  rows: Doc<"cardTombstones">[];
}> => {
  const after = args.after;
  const lowerBound = Math.max(args.since, after?.deletedAt ?? args.since);
  const rows: Doc<"cardTombstones">[] = [];
  let hasMore = false;
  const query = ctx.db
    .query("cardTombstones")
    .withIndex("by_userId_and_deletedAt", (q) =>
      q.eq("userId", args.userId).gte("deletedAt", lowerBound)
    )
    .order("asc");
  for await (const row of query) {
    if (
      after &&
      row.deletedAt === after.deletedAt &&
      row._creationTime <= after.creationTime
    ) {
      continue;
    }
    if (rows.length === args.limit) {
      hasMore = true;
      break;
    }
    rows.push(row);
  }
  return { hasMore, rows };
};

/** Deletes one page of a user's tombstones. Returns true when more remain. */
export const deleteCardTombstonesForUserPage = async (
  ctx: MutationCtx,
  userId: string,
  limit = PRUNE_BATCH_SIZE
): Promise<boolean> => {
  const rows = await ctx.db
    .query("cardTombstones")
    .withIndex("by_userId_and_deletedAt", (q) => q.eq("userId", userId))
    .take(limit);
  for (const row of rows) {
    await ctx.db.delete("cardTombstones", row._id);
  }
  return rows.length === limit;
};

/** Deletes expired tombstones in batches, rescheduling itself until done. */
export const pruneExpiredCardTombstones = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - CARD_TOMBSTONE_RETENTION_MS;
    const rows = await ctx.db
      .query("cardTombstones")
      .withIndex("by_deletedAt", (q) => q.lt("deletedAt", cutoff))
      .take(PRUNE_BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete("cardTombstones", row._id);
    }
    const hasMore = rows.length === PRUNE_BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any).publicApiTombstones.pruneExpiredCardTombstones,
        {}
      );
    }
    return { deleted: rows.length, hasMore };
  },
});
