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
import { TRASH_RETENTION_MS } from "./shared/constants";

// A client that syncs at least once per Trash purge never misses a deletion.
export const CARD_TOMBSTONE_RETENTION_MS = 3 * TRASH_RETENTION_MS;
const PRUNE_ON_WRITE_LIMIT = 5;
const PRUNE_BATCH_SIZE = 200;

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
