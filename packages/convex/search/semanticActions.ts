import {
  type FilesVectorQueryResult,
  vectorNamespaceForUser,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, action, internalQuery } from "../_generated/server";
import { expandFolderSearch } from "../card/searchPlanner";
import { getSessionUser } from "../securitySessions";
import { rateLimiter } from "../shared/rateLimits";
import { parseSearchQuery } from "../shared/search/qualifiers";
import { SEMANTIC_TOP_K, semanticQueryText } from "../shared/search/semantic";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { getR2KeyPrefix } from "../storage/r2Keys";
import { type SemanticRanking, semanticSearchKey } from "./semanticCache";

/**
 * The meaning side of a search. Only actions can call the vector service, so
 * the grid starts `requestSemanticResults` beside its reactive search query,
 * which merges the cached ranking in when it lands; the API waits for
 * `fetchSemanticRanking` before it reads a page.
 */

/** How long the API waits for meaning matches before going keyword-only. */
export const API_SEMANTIC_TIMEOUT_MS = 1500;
/** The grid shows keyword results meanwhile, so it can wait longer. */
const GRID_SEMANTIC_TIMEOUT_MS = 5000;

export type SemanticOutcome =
  /** Meaning matches, from the cache or the vector service. */
  | "ok"
  /** No free words to search by meaning. */
  | "skipped"
  | "rate_limited"
  /** The vector service failed, timed out or is not configured. */
  | "unavailable";

const outcomeValidator = v.union(
  v.literal("ok"),
  v.literal("skipped"),
  v.literal("rate_limited"),
  v.literal("unavailable")
);

/**
 * A user's meaning matches for `text` (from `semanticQueryText`), best
 * first: the cached ranking when there is one, otherwise a vector query
 * whose answer is cached. Null when there are none to merge; keyword search
 * then stands alone.
 */
export const fetchSemanticRanking = async (
  ctx: ActionCtx,
  userId: string,
  text: string,
  { timeoutMs = API_SEMANTIC_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<{ outcome: SemanticOutcome; ranking: SemanticRanking | null }> => {
  if (!text) {
    return { outcome: "skipped", ranking: null };
  }
  // A deployment without the Files Worker (a local stack) has no vectors.
  const namespace = vectorNamespaceForUser(`${getR2KeyPrefix()}${userId}`);
  if (!(namespace && isFilesWorkerConfigured())) {
    return { outcome: "unavailable", ranking: null };
  }
  const key = await semanticSearchKey(text);
  const cached: SemanticRanking | null = await ctx.runQuery(
    internal.search.semanticCache.getCachedRanking,
    { userId, key, now: Date.now() }
  );
  if (cached) {
    return { outcome: "ok", ranking: cached };
  }
  const shard: number | null = await ctx.runQuery(
    internal.vectorShards.getUserShard,
    { userId }
  );
  if (shard === null) {
    // No card of theirs has been embedded yet.
    return { outcome: "ok", ranking: [] };
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
    const result = await callFilesWorkerJson<FilesVectorQueryResult>({
      op: "vector-query",
      params: { namespace, shard, text, topK: SEMANTIC_TOP_K },
      timeoutMs,
    });
    if (result.kind !== "ok") {
      console.warn("[search/semantic] unavailable", {
        code: result.code,
        durationMs: Date.now() - startedAt,
      });
      return { outcome: "unavailable", ranking: null };
    }
    const ranking: SemanticRanking = await ctx.runMutation(
      internal.search.semanticCache.storeRanking,
      { userId, key, matches: result.data.matches }
    );
    return { outcome: "ok", ranking };
  } catch (error) {
    console.warn("[search/semantic] unavailable", {
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return { outcome: "unavailable", ranking: null };
  }
};

/** The signed-in user and the text the grid's search embeds. */
export const semanticSearchFor = internalQuery({
  args: {
    searchQuery: v.string(),
    folderId: v.optional(v.id("folders")),
    folderQuery: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ userId: v.string(), text: v.string() }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    // The same search the grid runs: a smart folder's words count too.
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
          text: semanticQueryText(parseSearchQuery(view.searchQuery)),
        }
      : null;
  },
});

/**
 * Starts the meaning side of a grid search. Pass the grid's own search
 * arguments; `searchCardsPaginated` with the same ones merges the matches in
 * once they are cached. Returns how it went, for the grid's hint.
 */
export const requestSemanticResults = action({
  args: {
    searchQuery: v.string(),
    folderId: v.optional(v.id("folders")),
    folderQuery: v.optional(v.string()),
  },
  returns: v.object({ outcome: outcomeValidator }),
  handler: async (ctx, args): Promise<{ outcome: SemanticOutcome }> => {
    const search: { userId: string; text: string } | null = await ctx.runQuery(
      internal.search.semanticActions.semanticSearchFor,
      args
    );
    if (!search) {
      return { outcome: "skipped" };
    }
    const { outcome } = await fetchSemanticRanking(
      ctx,
      search.userId,
      search.text,
      { timeoutMs: GRID_SEMANTIC_TIMEOUT_MS }
    );
    return { outcome };
  },
});
