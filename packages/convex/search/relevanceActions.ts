import {
  CLEF_FLASH_MODEL_ID,
  CLEF_INPUT_USD_PER_MILLION,
  type FilesRelevanceResult,
  readRelevanceResult,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, action } from "../_generated/server";
import { searchCardsPaginatedArgsValidator } from "../card/getCards";
import { rateLimiter } from "../shared/rateLimits";
import {
  buildRelevanceCardText,
  currentRelevanceScores,
  RELEVANCE_CANDIDATE_LIMIT,
  type RelevanceScore,
  relevanceSearchKey,
} from "../shared/search/relevance";
import type { SemanticRequest } from "../shared/search/semantic";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { fetchSemanticRanking } from "./semanticActions";

/**
 * Best match. Only actions can call Clef, so the grid starts
 * `requestRelevanceScores` beside its search and the API scores before it
 * reads a page. Both send the search's top results to the Files Worker's
 * `score-relevance` op and cache the scores.
 */

export const API_RELEVANCE_TIMEOUT_MS = 1500;
const GRID_RELEVANCE_TIMEOUT_MS = 3000;
/** The grid also waits for the meaning side, as `requestSemanticResults`. */
const GRID_SEMANTIC_TIMEOUT_MS = 5000;

export type RelevanceOutcome =
  /** Every candidate has a current score. */
  | "ok"
  /** No free words, no candidates, or AI turned off. */
  | "skipped"
  | "rate_limited"
  /** The Files Worker or Clef failed, timed out or is not configured. */
  | "unavailable";

const outcomeValidator = v.union(
  v.literal("ok"),
  v.literal("skipped"),
  v.literal("rate_limited"),
  v.literal("unavailable")
);

type CandidateCard = Pick<
  Doc<"cards">,
  | "_id"
  | "aiSummary"
  | "aiTags"
  | "content"
  | "metadata"
  | "metadataTitle"
  | "notes"
  | "tags"
  | "type"
  | "updatedAt"
  | "urlHost"
>;

/**
 * Scores the candidates that have no current score and caches them. A
 * search spends one `semanticSearch` token in all: pass `spentToken` when its
 * meaning lookup already took one.
 */
export const ensureRelevanceScores = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  {
    candidates,
    spentToken = false,
    text,
    timeoutMs = API_RELEVANCE_TIMEOUT_MS,
    userId,
  }: {
    candidates: readonly CandidateCard[];
    spentToken?: boolean;
    text: string;
    timeoutMs?: number;
    userId: string;
  }
): Promise<{ outcome: RelevanceOutcome; scores: RelevanceScore[] | null }> => {
  const cards = candidates.slice(0, RELEVANCE_CANDIDATE_LIMIT);
  if (!(text && cards.length)) {
    return { outcome: "skipped", scores: null };
  }
  if (!isFilesWorkerConfigured()) {
    return { outcome: "unavailable", scores: null };
  }
  if (
    (await ctx.runQuery(internal.adminAccess.getAiGate, { userId })) !==
    "allowed"
  ) {
    return { outcome: "skipped", scores: null };
  }
  const key = await relevanceSearchKey(text);
  const cached: RelevanceScore[] | null = await ctx.runQuery(
    internal.search.relevanceCache.getScores,
    { userId, key }
  );
  const current = currentRelevanceScores(cached, cards);
  const missing = cards.filter((card) => !current.has(card._id));
  if (missing.length === 0) {
    return { outcome: "ok", scores: cached };
  }
  if (!spentToken) {
    const limit = await rateLimiter.limit(ctx as ActionCtx, "semanticSearch", {
      key: userId,
      throws: false,
    });
    if (!limit.ok) {
      console.warn("[search/relevance] rate_limited", { userId });
      return { outcome: "rate_limited", scores: cached };
    }
  }
  const startedAt = Date.now();
  let result: FilesRelevanceResult | null = null;
  try {
    const outcome = await callFilesWorkerJson<unknown>({
      op: "score-relevance",
      params: {
        query: text,
        cards: missing.map((card) => ({
          id: card._id,
          text: buildRelevanceCardText(card),
        })),
      },
      timeoutMs,
    });
    result =
      outcome.kind === "ok"
        ? readRelevanceResult(
            outcome.data,
            missing.map((card) => card._id)
          )
        : null;
  } catch (error) {
    console.warn("[search/relevance] unavailable", {
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      durationMs: Date.now() - startedAt,
    });
  }
  await ctx.runMutation(internal.adminUsage.recordAiUsage, {
    userId,
    calls: 1,
    errors: result ? 0 : 1,
    inputTokens: result?.usage?.inputTokens ?? 0,
    outputTokens: result?.usage?.outputTokens ?? 0,
    costUsd:
      ((result?.usage?.inputTokens ?? 0) *
        (CLEF_INPUT_USD_PER_MILLION[CLEF_FLASH_MODEL_ID] ?? 0)) /
      1_000_000,
  });
  if (!result) {
    return { outcome: "unavailable", scores: cached };
  }
  const updatedAt = new Map<string, number>(
    missing.map((card) => [card._id, card.updatedAt])
  );
  const fresh = result.scores.map(({ id, score }) => ({
    cardId: id as Doc<"cards">["_id"],
    score,
    cardUpdatedAt: updatedAt.get(id) ?? 0,
  }));
  const stored: boolean = await ctx.runMutation(
    internal.search.relevanceCache.storeScores,
    { userId, key, scores: fresh }
  );
  // Refused (the account is being deleted): the grid would read no scores.
  if (!stored) {
    return { outcome: "unavailable", scores: cached };
  }
  const freshIds = new Set<string>(fresh.map((entry) => entry.cardId));
  return {
    outcome: "ok",
    scores: [
      ...fresh,
      ...(cached ?? []).filter((entry) => !freshIds.has(entry.cardId)),
    ],
  };
};

const { paginationOpts: _paginationOpts, ...gridSearchArgs } =
  searchCardsPaginatedArgsValidator.fields;

/**
 * Starts Best match for a grid search. Pass the grid's own search arguments
 * (any sort): this scores the search's top results, and the grid then reads
 * `searchCardsPaginated` with `sort: "relevance"` and `useRelevanceScores`.
 * Returns how it went.
 */
export const requestRelevanceScores = action({
  args: gridSearchArgs,
  returns: v.object({ outcome: outcomeValidator }),
  handler: async (ctx, args): Promise<{ outcome: RelevanceOutcome }> => {
    const search: {
      userId: string;
      request: SemanticRequest | null;
    } | null = await ctx.runQuery(
      internal.search.semanticActions.semanticSearchFor,
      {
        searchQuery: args.searchQuery ?? "",
        ...(args.folderId ? { folderId: args.folderId } : {}),
        ...(args.folderQuery === undefined
          ? {}
          : { folderQuery: args.folderQuery }),
      }
    );
    // Best match scores free words; `like:` and `mood:` lists keep their order.
    if (search?.request?.kind !== "text") {
      return { outcome: "skipped" };
    }
    const { request, userId } = search;
    const semantic =
      args.mode === "keyword"
        ? null
        : await fetchSemanticRanking(ctx, userId, request, {
            timeoutMs: GRID_SEMANTIC_TIMEOUT_MS,
          });
    const page = await ctx.runQuery(api.cards.searchCardsPaginated, {
      ...args,
      sort: "relevance",
      useRelevanceScores: false,
      shuffleSeed: undefined,
      paginationOpts: { numItems: RELEVANCE_CANDIDATE_LIMIT, cursor: null },
    });
    const { outcome } = await ensureRelevanceScores(ctx, {
      candidates: page.page as CandidateCard[],
      spentToken: semantic?.spentToken === true,
      text: request.text,
      timeoutMs: GRID_RELEVANCE_TIMEOUT_MS,
      userId,
    });
    return { outcome };
  },
});
