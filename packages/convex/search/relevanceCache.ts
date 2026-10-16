import { RELEVANCE_MAX_SCORE } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import {
  RELEVANCE_CANDIDATE_LIMIT,
  type RelevanceScore,
  relevanceSearchKey,
} from "../shared/search/relevance";

/**
 * Best match scores, so every page and re-render of one search reads the
 * same order and Clef is asked once per card. Queries only read it; actions
 * fill it. A score stays valid until its card is edited, so a row lives a
 * day after its last write: a grid left open never loses its order to the
 * cleanup, and a ranked API pagination keeps its scores.
 */

export const RELEVANCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 500;
/** One search keeps the scores of at most this many cards. */
const MAX_SCORES_PER_SEARCH = RELEVANCE_CANDIDATE_LIMIT * 8;

export const relevanceScoreValidator = v.object({
  cardId: v.id("cards"),
  score: v.number(),
  cardUpdatedAt: v.number(),
});

const findEntry = (ctx: QueryCtx, userId: string, key: string) =>
  ctx.db
    .query("searchRelevanceResults")
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", userId).eq("key", key)
    )
    .first();

/**
 * A search's scores, or null. Read until the cleanup removes the entry, so
 * later pages of a ranked search keep the order its first page had.
 */
export const readRelevanceScores = async (
  ctx: QueryCtx,
  userId: string,
  text: string
): Promise<RelevanceScore[] | null> => {
  const entry = await findEntry(ctx, userId, await relevanceSearchKey(text));
  return entry ? entry.scores : null;
};

export const getScores = internalQuery({
  args: { userId: v.string(), key: v.string() },
  returns: v.union(v.array(relevanceScoreValidator), v.null()),
  handler: async (ctx, { userId, key }) =>
    (await findEntry(ctx, userId, key))?.scores ?? null,
});

/**
 * Adds scores to a search's entry, replacing older scores of the same cards.
 * Refuses while the account is being deleted, so a Clef reply that lands
 * after the deletion's cleanup can't leave a row behind.
 */
export const storeScores = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    scores: v.array(relevanceScoreValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, key, scores }) => {
    if (await createAccountDeletionGate(ctx)(userId)) {
      return false;
    }
    const fresh = new Map<string, (typeof scores)[number]>();
    for (const entry of scores) {
      const card = await ctx.db.get("cards", entry.cardId);
      if (
        card?.userId === userId &&
        Number.isFinite(entry.score) &&
        entry.score >= 0 &&
        entry.score <= RELEVANCE_MAX_SCORE
      ) {
        fresh.set(entry.cardId, entry);
      }
    }
    const now = Date.now();
    const existing = await findEntry(ctx, userId, key);
    const merged = [
      ...fresh.values(),
      ...(existing?.scores ?? []).filter((entry) => !fresh.has(entry.cardId)),
    ].slice(0, MAX_SCORES_PER_SEARCH);
    const row = {
      userId,
      key,
      scores: merged,
      createdAt: existing?.createdAt ?? now,
      expiresAt: now + RELEVANCE_CACHE_TTL_MS,
    };
    if (existing) {
      await ctx.db.replace("searchRelevanceResults", existing._id, row);
    } else {
      await ctx.db.insert("searchRelevanceResults", row);
    }
    return true;
  },
});

/** Cron: removes expired entries, a batch at a time. */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("searchRelevanceResults")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH);
    for (const entry of expired) {
      await ctx.db.delete("searchRelevanceResults", entry._id);
    }
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.search.relevanceCache.cleanupExpired,
        {}
      );
    }
    return expired.length;
  },
});
