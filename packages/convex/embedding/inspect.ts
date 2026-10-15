import {
  type FilesVectorQueryResult,
  vectorNamespaceForUser,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { getR2KeyPrefix } from "../storage/r2Keys";

/**
 * Operator check of a user's meaning matches, with each card's title and
 * score. Internal, so only the Convex dashboard or CLI can run it:
 *
 *   npx convex run embedding/inspect:searchByMeaning \
 *     '{"userId":"teak_…","text":"furniture wood that survives rain"}'
 */

const PREVIEW_CHARS = 80;

export const describeCards = internalQuery({
  args: { cardIds: v.array(v.string()), userId: v.string() },
  returns: v.array(
    v.object({ cardId: v.string(), preview: v.union(v.string(), v.null()) })
  ),
  handler: async (ctx, { cardIds, userId }) => {
    const described: { cardId: string; preview: string | null }[] = [];
    for (const cardId of cardIds) {
      const id = ctx.db.normalizeId("cards", cardId);
      const card = id ? await ctx.db.get("cards", id) : null;
      const text =
        card?.userId === userId
          ? (card.metadataTitle ??
            card.metadata?.linkPreview?.title ??
            card.content ??
            card.url ??
            card.type)
          : null;
      described.push({
        cardId,
        preview: text ? text.slice(0, PREVIEW_CHARS) : null,
      });
    }
    return described;
  },
});

export const searchByMeaning = internalAction({
  args: {
    userId: v.string(),
    text: v.string(),
    topK: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      cardId: v.string(),
      score: v.number(),
      preview: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, { userId, text, topK }) => {
    const shard: number | null = await ctx.runQuery(
      internal.vectorShards.getUserShard,
      { userId }
    );
    const namespace = vectorNamespaceForUser(`${getR2KeyPrefix()}${userId}`);
    if (shard === null || !namespace) {
      // No card of theirs was ever embedded.
      return [];
    }
    const outcome = await callFilesWorkerJson<FilesVectorQueryResult>({
      op: "vector-query",
      params: {
        namespace,
        shard,
        text,
        topK: Math.min(Math.max(Math.trunc(topK ?? 10), 1), 100),
      },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`vector_query_${outcome.code}`);
    }
    const described: Array<{ cardId: string; preview: string | null }> =
      await ctx.runQuery(internal.embedding.inspect.describeCards, {
        cardIds: outcome.data.matches.map((match) => match.id),
        userId,
      });
    return outcome.data.matches.map((match, i) => ({
      cardId: match.id,
      score: match.score,
      preview: described[i]?.preview ?? null,
    }));
  },
});
