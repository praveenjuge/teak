import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { semanticSearchText } from "../lib/cardsSearchState";

/**
 * How long a search that found no words waits for its meaning matches before
 * it shows the empty state: the action gives up on the Core Worker after 5 s
 * (`GRID_SEMANTIC_TIMEOUT_MS`), so this only caps an action that never
 * answers. A cold meaning search takes about 2 s; giving up at 1.5 s showed
 * "Nothing found" before its matches landed.
 */
export const SEMANTIC_EMPTY_STATE_WAIT_MS = 6000;
/**
 * An action answers without waiting for the grid's query to read the ranking
 * it stored, so a found ranking gets this long to reach the grid.
 */
export const SEMANTIC_RESULTS_LAND_MS = 500;

export type SemanticSearchOutcome =
  | "ok"
  | "skipped"
  | "rate_limited"
  | "unavailable"
  | "pending"
  | "anchor_unavailable";

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

  const request = useMemo(
    () => (requestKey ? { attempt, key: requestKey } : null),
    [attempt, requestKey]
  );

  useEffect(() => {
    if (!request) {
      setPendingFor(null);
      return;
    }
    setPendingFor(request.key);
    // A superseded request (a newer query, or a retry of this one) must not
    // overwrite the current answer or end the current wait when it lands.
    let live = true;
    const settle = () => {
      if (live) {
        setPendingFor((current) => (current === request.key ? null : current));
      }
    };
    let timeout = setTimeout(settle, SEMANTIC_EMPTY_STATE_WAIT_MS);
    const answerWith = (outcome: SemanticSearchOutcome) => {
      if (!live) {
        return;
      }
      setAnswer({ key: request.key, outcome });
      clearTimeout(timeout);
      if (outcome === "ok") {
        timeout = setTimeout(settle, SEMANTIC_RESULTS_LAND_MS);
      } else {
        settle();
      }
    };
    requestSemanticResults({
      searchQuery,
      ...(folderId ? { folderId } : {}),
      ...(folderQuery === undefined ? {} : { folderQuery }),
    })
      .then(({ outcome }) => answerWith(outcome))
      .catch(() => answerWith("unavailable"));
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [folderId, folderQuery, request, requestSemanticResults, searchQuery]);

  return {
    isPending: requestKey !== null && pendingFor === requestKey,
    outcome: answer && answer.key === requestKey ? answer.outcome : null,
    retry,
  };
}
