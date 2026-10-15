import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  combineSearchQueries,
  parseSearchQuery,
  semanticRequestFor,
} from "@teak/convex/shared";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";

/** How long an empty grid waits for meaning matches before saying so. */
export const SEMANTIC_EMPTY_STATE_WAIT_MS = 1500;

/**
 * What a grid search asks by meaning (its words, a `like:` card or a
 * `mood:`), from the typed search and a smart folder's, as the server
 * combines them. Empty when there is nothing to search by meaning.
 */
export const semanticSearchText = (
  searchQuery: string,
  folderQuery?: string
): string => {
  const combined =
    folderQuery === undefined
      ? searchQuery
      : combineSearchQueries(folderQuery, searchQuery);
  return combined === null
    ? ""
    : (semanticRequestFor(parseSearchQuery(combined))?.cacheText ?? "");
};

/** How the latest request went (see `requestSemanticResults`). */
export type SemanticSearchOutcome =
  | "ok"
  | "skipped"
  | "rate_limited"
  | "unavailable"
  | "pending"
  | "anchor_unavailable";

/**
 * Starts the meaning side of a grid search beside its query. The grid query
 * merges the matches in by itself once they are cached, so the answer is
 * not used; `isPending` only holds an empty grid's "No cards found" for a
 * moment, so a search that matches by meaning alone never flashes it.
 */
export function useSemanticSearch(args: {
  enabled?: boolean;
  folderId?: Id<"folders">;
  folderQuery?: string;
  searchQuery?: string;
}): {
  isPending: boolean;
  outcome: SemanticSearchOutcome | null;
  retry: () => void;
} {
  const requestSemanticResults = useAction(
    api.search.semanticActions.requestSemanticResults
  );
  const { enabled = true, folderId, folderQuery } = args;
  const searchQuery = args.searchQuery ?? "";
  const text = enabled ? semanticSearchText(searchQuery, folderQuery) : "";
  // The search the latest request was for; a slower older one can't clear it.
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    key: string;
    outcome: SemanticSearchOutcome;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const requestKey = text
    ? JSON.stringify([searchQuery, folderId ?? null, folderQuery ?? null])
    : null;

  // `attempt` asks again (Retry) for the same search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry trigger.
  useEffect(() => {
    if (!requestKey) {
      setPendingFor(null);
      return;
    }
    setPendingFor(requestKey);
    const settle = () =>
      setPendingFor((current) => (current === requestKey ? null : current));
    const timeout = setTimeout(settle, SEMANTIC_EMPTY_STATE_WAIT_MS);
    // Down, slow or rate-limited, the search stays keyword-only.
    requestSemanticResults({
      searchQuery,
      ...(folderId ? { folderId } : {}),
      ...(folderQuery === undefined ? {} : { folderQuery }),
    })
      .then(({ outcome }) => setAnswer({ key: requestKey, outcome }))
      .catch(() => setAnswer({ key: requestKey, outcome: "unavailable" }))
      .finally(settle);
    return () => clearTimeout(timeout);
  }, [
    attempt,
    folderId,
    folderQuery,
    requestKey,
    requestSemanticResults,
    searchQuery,
  ]);

  return {
    isPending: requestKey !== null && pendingFor === requestKey,
    outcome: answer && answer.key === requestKey ? answer.outcome : null,
    retry,
  };
}
