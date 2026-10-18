import type {
  FilesVectorQueryResult,
  FilesVectorSimilarResult,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, action, internalQuery } from "../_generated/server";
import { expandFolderSearch } from "../card/searchPlanner";
import { isSimilarAnchorAvailable } from "../card/similarSearch";
import {
  readUserVectorShard,
  userVectorNamespace,
} from "../embedding/userVectors";
import { getSessionUser } from "../securitySessions";
import { rateLimiter } from "../shared/rateLimits";
import { parseSearchQuery } from "../shared/search/qualifiers";
import {
  SEMANTIC_TOP_K,
  type SemanticRequest,
  semanticRequestFor,
} from "../shared/search/semantic";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import {
  type SemanticEntry,
  type SemanticRanking,
  semanticSearchKey,
} from "./semanticCache";

export const API_SEMANTIC_TIMEOUT_MS = 1500;
const GRID_SEMANTIC_TIMEOUT_MS = 5000;

export type SemanticOutcome =
  | "ok"
  | "skipped"
  | "rate_limited"
  | "unavailable"
  | "pending"
  | "anchor_unavailable";

const outcomeValidator = v.union(
  v.literal("ok"),
  v.literal("skipped"),
  v.literal("rate_limited"),
  v.literal("unavailable"),
  v.literal("pending"),
  v.literal("anchor_unavailable")
);

export const checkSimilarAnchor = internalQuery({
  args: { userId: v.string(), cardId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, cardId }) =>
    isSimilarAnchorAvailable(ctx, userId, cardId),
});

const askVectorService = async (
  request: SemanticRequest,
  vectors: { namespace: string; shard: number },
  timeoutMs: number
): Promise<{ matches: { id: string; score: number }[]; found: boolean }> => {
  if (request.kind === "like") {
    const result = await callFilesWorkerJson<FilesVectorSimilarResult>({
      op: "vector-similar",
      params: { ...vectors, id: request.cardId, topK: SEMANTIC_TOP_K },
      timeoutMs,
    });
    if (result.kind !== "ok") {
      throw new Error(`vector_similar_${result.code}`);
    }
    return result.data;
  }
  const result = await callFilesWorkerJson<FilesVectorQueryResult>({
    op: "vector-query",
    params: {
      ...vectors,
      text: request.text,
      topK: SEMANTIC_TOP_K,
      ...(request.kind === "mood" ? { type: "image" } : {}),
    },
    timeoutMs,
  });
  if (result.kind !== "ok") {
    throw new Error(`vector_query_${result.code}`);
  }
  return { found: true, matches: result.data.matches };
};

export const fetchSemanticRanking = async (
  ctx: ActionCtx,
  userId: string,
  request: SemanticRequest | null,
  { timeoutMs = API_SEMANTIC_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<{
  outcome: SemanticOutcome;
  ranking: SemanticRanking | null;
  spentToken?: true;
}> => {
  if (!request) {
    return { outcome: "skipped", ranking: null };
  }
  if (
    request.kind === "like" &&
    !(await ctx.runQuery(internal.search.semanticActions.checkSimilarAnchor, {
      userId,
      cardId: request.cardId,
    }))
  ) {
    return { outcome: "anchor_unavailable", ranking: null };
  }
  const namespace = userVectorNamespace(userId);
  if (!(namespace && isFilesWorkerConfigured())) {
    return { outcome: "unavailable", ranking: null };
  }
  const key = await semanticSearchKey(request.cacheText);
  const cached: SemanticEntry | null = await ctx.runQuery(
    internal.search.semanticCache.getCachedRanking,
    { userId, key, now: Date.now() }
  );
  if (cached) {
    return cached.status === "pending"
      ? { outcome: "pending", ranking: null }
      : { outcome: "ok", ranking: cached.ranking };
  }
  const vectorShard = await readUserVectorShard(ctx, userId);
  if (vectorShard.kind === "never_embedded") {
    return request.kind === "like"
      ? { outcome: "pending", ranking: null }
      : { outcome: "ok", ranking: [] };
  }
  const limit = await rateLimiter.limit(ctx, "semanticSearch", {
    key: userId,
    throws: false,
  });
  if (!limit.ok) {
    console.warn("[search/semantic] rate_limited", { userId });
    return { outcome: "rate_limited", ranking: null };
  }
  const startedAt = Date.now();
  try {
    const { found, matches } = await askVectorService(
      request,
      { namespace, shard: vectorShard.shard },
      timeoutMs
    );
    const ranking: SemanticRanking = await ctx.runMutation(
      internal.search.semanticCache.storeRanking,
      { userId, key, matches, ...(found ? {} : { pending: true }) }
    );
    return found
      ? { outcome: "ok", ranking, spentToken: true }
      : { outcome: "pending", ranking: null, spentToken: true };
  } catch (error) {
    console.warn("[search/semantic] unavailable", {
      kind: request.kind,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return { outcome: "unavailable", ranking: null, spentToken: true };
  }
};

const requestValidator = v.union(
  v.object({
    kind: v.literal("text"),
    text: v.string(),
    cacheText: v.string(),
  }),
  v.object({
    kind: v.literal("like"),
    cardId: v.string(),
    cacheText: v.string(),
  }),
  v.object({ kind: v.literal("mood"), text: v.string(), cacheText: v.string() })
);

export const semanticSearchFor = internalQuery({
  args: {
    searchQuery: v.string(),
    folderId: v.optional(v.id("folders")),
    folderQuery: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      userId: v.string(),
      request: v.union(requestValidator, v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const view = await expandFolderSearch(
      ctx,
      user.teakUserId,
      args.folderId,
      args.searchQuery,
      args.folderQuery
    );
    return view
      ? {
          userId: user.teakUserId,
          request: semanticRequestFor(parseSearchQuery(view.searchQuery)),
        }
      : null;
  },
});

export const requestSemanticResults = action({
  args: {
    searchQuery: v.string(),
    folderId: v.optional(v.id("folders")),
    folderQuery: v.optional(v.string()),
  },
  returns: v.object({ outcome: outcomeValidator }),
  handler: async (ctx, args): Promise<{ outcome: SemanticOutcome }> => {
    const search: {
      userId: string;
      request: SemanticRequest | null;
    } | null = await ctx.runQuery(
      internal.search.semanticActions.semanticSearchFor,
      args
    );
    if (!search) {
      return { outcome: "skipped" };
    }
    const { outcome } = await fetchSemanticRanking(
      ctx,
      search.userId,
      search.request,
      { timeoutMs: GRID_SEMANTIC_TIMEOUT_MS }
    );
    return { outcome };
  },
});
