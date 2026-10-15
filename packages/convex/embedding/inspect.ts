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
 * Operator check that a user's vectors answer by meaning, until search uses
 * them. Internal, so only the Convex dashboard or CLI can run it:
 *
 *   npx convex run embedding/inspect:searchByMeaning \
 *     '{"userId":"teak_…","text":"furniture wood that survives rain"}'
 */

const PREVIEW_CHARS = 80;

/** The user's shard, without placing a user who has none (a typo). */
export const userShard = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("vectorShards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return row?.shard ?? null;
  },
});

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
      internal.embedding.inspect.userShard,
      { userId }
    );
    const namespace = vectorNamespaceForUser(`${getR2KeyPrefix()}${userId}`);
    if (shard === null || !namespace) {
      // No card of theirs was ever embedded.
      return [];
    }
    const outcome = await callFilesWorkerJson<FilesVectorQueryResult>({
      op: "vector-query",
      params: { namespace, shard, text, topK: topK ?? 10 },
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
