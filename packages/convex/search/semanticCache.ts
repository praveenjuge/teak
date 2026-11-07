import { CARD_EMBEDDING_VERSION, sha256Hex } from "@teak/files-protocol";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { SEMANTIC_TOP_K } from "../shared/search/semantic";
import {
  deleteExpiredResults,
  findCachedResult,
  writeCachedResult,
} from "./resultCache";

export const SEMANTIC_CACHE_TTL_MS = 10 * 60 * 1000;
export const SEMANTIC_PENDING_TTL_MS = 15 * 1000;

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
  findCachedResult(ctx, "semanticSearchResults", userId, key);

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
    await writeCachedResult(
      ctx,
      "semanticSearchResults",
      await findEntry(ctx, userId, key),
      {
        userId,
        key,
        ...(pending ? { status: "pending" as const } : {}),
        ranking: pending ? [] : ranking,
        createdAt: now,
        expiresAt:
          now + (pending ? SEMANTIC_PENDING_TTL_MS : SEMANTIC_CACHE_TTL_MS),
      }
    );
    return ranking;
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: (ctx) => deleteExpiredResults(ctx, "semanticSearchResults"),
});
