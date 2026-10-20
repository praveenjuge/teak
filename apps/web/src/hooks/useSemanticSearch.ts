import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  combineSearchQueries,
  parseSearchQuery,
  semanticRequestFor,
} from "@teak/convex/shared";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";

export const SEMANTIC_EMPTY_STATE_WAIT_MS = 1500;

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
    const settle = () =>
      setPendingFor((current) => (current === request.key ? null : current));
    const timeout = setTimeout(settle, SEMANTIC_EMPTY_STATE_WAIT_MS);
    requestSemanticResults({
      searchQuery,
      ...(folderId ? { folderId } : {}),
      ...(folderQuery === undefined ? {} : { folderQuery }),
    })
      .then(({ outcome }) => setAnswer({ key: request.key, outcome }))
      .catch(() => setAnswer({ key: request.key, outcome: "unavailable" }))
      .finally(settle);
    return () => clearTimeout(timeout);
  }, [folderId, folderQuery, request, requestSemanticResults, searchQuery]);

  return {
    isPending: requestKey !== null && pendingFor === requestKey,
    outcome: answer && answer.key === requestKey ? answer.outcome : null,
    retry,
  };
}
