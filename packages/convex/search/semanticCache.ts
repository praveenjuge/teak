import { CARD_EMBEDDING_VERSION } from "@teak/files-protocol";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { SEMANTIC_TOP_K } from "../shared/search/semantic";
import { sha256Hex } from "../storage/r2Keys";

export const SEMANTIC_CACHE_TTL_MS = 10 * 60 * 1000;
export const SEMANTIC_PENDING_TTL_MS = 15 * 1000;
const CLEANUP_BATCH = 500;

export const semanticRankingValidator = v.array(
  v.object({ cardId: v.id("cards"), score: v.number() })
);
export type SemanticRanking = { cardId: Id<"cards">; score: number }[];

export const semanticEntryValidator = v.object({
  status: v.union(v.literal("ok"), v.literal("pending")),
  ranking: semanticRankingValidator,
});
export interface SemanticEntry {
  ranking: SemanticRanking;
  status: "ok" | "pending";
}

export const semanticSearchKey = (text: string): Promise<string> =>
  sha256Hex(`${CARD_EMBEDDING_VERSION}\n${text}`);

const findEntry = (ctx: QueryCtx, userId: string, key: string) =>
  ctx.db
    .query("semanticSearchResults")
    .withIndex("by_userId_and_key", (q) =>
      q.eq("userId", userId).eq("key", key)
    )
    .first();

export const readSemanticEntry = async (
  ctx: QueryCtx,
  userId: string,
  cacheText: string
): Promise<SemanticEntry | null> => {
  const entry = await findEntry(
    ctx,
    userId,
    await semanticSearchKey(cacheText)
  );
  return entry
    ? { status: entry.status ?? "ok", ranking: entry.ranking }
    : null;
};

export const readSemanticRanking = async (
  ctx: QueryCtx,
  userId: string,
  cacheText: string
): Promise<SemanticRanking | null> => {
  const entry = await readSemanticEntry(ctx, userId, cacheText);
  return entry?.status === "ok" ? entry.ranking : null;
};

export const getCachedRanking = internalQuery({
  args: { userId: v.string(), key: v.string(), now: v.number() },
  returns: v.union(semanticEntryValidator, v.null()),
  handler: async (ctx, { userId, key, now }) => {
    const entry = await findEntry(ctx, userId, key);
    return entry && entry.expiresAt > now
      ? { status: entry.status ?? ("ok" as const), ranking: entry.ranking }
      : null;
  },
});

export const storeRanking = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    matches: v.array(v.object({ id: v.string(), score: v.number() })),
    pending: v.optional(v.boolean()),
  },
  returns: semanticRankingValidator,
  handler: async (ctx, { userId, key, matches, pending }) => {
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
      ...(pending ? { status: "pending" as const } : {}),
      ranking: pending ? [] : ranking,
      createdAt: now,
      expiresAt:
        now + (pending ? SEMANTIC_PENDING_TTL_MS : SEMANTIC_CACHE_TTL_MS),
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

/** The Core Worker's hourly cron calls this until `hasMore` is false. */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("semanticSearchResults")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH);
    for (const entry of expired) {
      await ctx.db.delete("semanticSearchResults", entry._id);
    }
    return {
      deleted: expired.length,
      hasMore: expired.length === CLEANUP_BATCH,
    };
  },
});
