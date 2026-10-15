import { CARD_EMBEDDING_VERSION } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { SEMANTIC_TOP_K } from "../shared/search/semantic";

/**
 * A search's meaning matches, kept briefly so every page, re-render and
 * surface of one search reads the same ranking and the vector service is
 * asked once. Search queries only read it; actions fill it.
 */

/** How long one search's meaning matches are reused. */
export const SEMANTIC_CACHE_TTL_MS = 10 * 60 * 1000;
/** Expired rows one cleanup run removes before it schedules the next. */
const CLEANUP_BATCH = 500;

export const semanticRankingValidator = v.array(
  v.object({ cardId: v.id("cards"), score: v.number() })
);
export type SemanticRanking = { cardId: Id<"cards">; score: number }[];

/**
 * The cache key for a search's embedded text: its hash with the embedding
 * version, so the table never holds what someone searched for and a new
 * model never reuses an old ranking.
 */
export const semanticSearchKey = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${CARD_EMBEDDING_VERSION}\n${text}`)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const findEntry = (ctx: QueryCtx, userId: string, key: string) =>
  ctx.db
    .query("semanticSearchResults")
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", userId).eq("key", key)
    )
    .first();

/**
 * The cached ranking for a search, or null. Queries read an entry until the
 * cleanup removes it, so a page of results never changes when the clock
 * passes `expiresAt`; actions refresh an expired entry.
 */
export const readSemanticRanking = async (
  ctx: QueryCtx,
  userId: string,
  text: string
): Promise<SemanticRanking | null> => {
  const entry = await findEntry(ctx, userId, await semanticSearchKey(text));
  return entry ? entry.ranking : null;
};

export const getCachedRanking = internalQuery({
  args: { userId: v.string(), key: v.string(), now: v.number() },
  returns: v.union(semanticRankingValidator, v.null()),
  handler: async (ctx, { userId, key, now }) => {
    const entry = await findEntry(ctx, userId, key);
    return entry && entry.expiresAt > now ? entry.ranking : null;
  },
});

export const storeRanking = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    /** Vectorize's matches; ids that are not this user's cards are dropped. */
    matches: v.array(v.object({ id: v.string(), score: v.number() })),
  },
  returns: semanticRankingValidator,
  handler: async (ctx, { userId, key, matches }) => {
    const ranking: SemanticRanking = [];
    for (const match of matches.slice(0, SEMANTIC_TOP_K)) {
      const cardId = ctx.db.normalizeId("cards", match.id);
      if (cardId && Number.isFinite(match.score)) {
        ranking.push({ cardId, score: match.score });
      }
    }
    const now = Date.now();
    const entry = {
      userId,
      key,
      ranking,
      createdAt: now,
      expiresAt: now + SEMANTIC_CACHE_TTL_MS,
    };
    const existing = await findEntry(ctx, userId, key);
    if (existing) {
      await ctx.db.replace("semanticSearchResults", existing._id, entry);
    } else {
      await ctx.db.insert("semanticSearchResults", entry);
    }
    return ranking;
  },
});

/** Cron: removes expired entries, a batch at a time. */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("semanticSearchResults")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH);
    for (const entry of expired) {
      await ctx.db.delete("semanticSearchResults", entry._id);
    }
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.search.semanticCache.cleanupExpired,
        {}
      );
    }
    return expired.length;
  },
});
