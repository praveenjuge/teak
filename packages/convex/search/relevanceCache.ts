import { RELEVANCE_MAX_SCORE } from "@teak/files-protocol";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import {
  RELEVANCE_CANDIDATE_LIMIT,
  type RelevanceScore,
  relevanceSearchKey,
} from "../shared/search/relevance";
import {
  deleteExpiredResults,
  findCachedResult,
  writeCachedResult,
} from "./resultCache";

export const RELEVANCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SCORES_PER_SEARCH = RELEVANCE_CANDIDATE_LIMIT * 8;

export const relevanceScoreValidator = v.object({
  cardId: v.id("cards"),
  score: v.number(),
  cardUpdatedAt: v.number(),
});

const findEntry = (ctx: QueryCtx, userId: string, key: string) =>
  findCachedResult(ctx, "searchRelevanceResults", userId, key);

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
    await writeCachedResult(ctx, "searchRelevanceResults", existing, {
      userId,
      key,
      scores: merged,
      createdAt: existing?.createdAt ?? now,
      expiresAt: now + RELEVANCE_CACHE_TTL_MS,
    });
    return true;
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: (ctx) => deleteExpiredResults(ctx, "searchRelevanceResults"),
});
