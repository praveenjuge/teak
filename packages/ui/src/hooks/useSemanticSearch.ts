import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  combineSearchQueries,
  parseSearchQuery,
  semanticQueryText,
} from "@teak/convex/shared";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

/** How long an empty grid waits for meaning matches before saying so. */
export const SEMANTIC_EMPTY_STATE_WAIT_MS = 1500;

/**
 * The words a grid search embeds: the typed search and a smart folder's,
 * as the server combines them. Empty when there are none to search by
 * meaning.
 */
export const semanticSearchText = (
  searchQuery: string,
  folderQuery?: string
): string => {
  const combined =
    folderQuery === undefined
      ? searchQuery
      : combineSearchQueries(folderQuery, searchQuery);
  return combined === null ? "" : semanticQueryText(parseSearchQuery(combined));
};

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
}): { isPending: boolean } {
  const requestSemanticResults = useAction(
    api.search.semanticActions.requestSemanticResults
  );
  const { enabled = true, folderId, folderQuery } = args;
  const searchQuery = args.searchQuery ?? "";
  const text = enabled ? semanticSearchText(searchQuery, folderQuery) : "";
  // The search the latest request was for; a slower older one can't clear it.
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const requestKey = text
    ? JSON.stringify([searchQuery, folderId ?? null, folderQuery ?? null])
    : null;

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
      .catch(() => undefined)
      .finally(settle);
    return () => clearTimeout(timeout);
  }, [folderId, folderQuery, requestKey, requestSemanticResults, searchQuery]);

  return { isPending: requestKey !== null && pendingFor === requestKey };
}
