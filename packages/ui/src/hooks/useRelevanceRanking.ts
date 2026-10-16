import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { RELEVANCE_HOLD_MS } from "@teak/convex/shared/search/relevance";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { semanticSearchText } from "./useSemanticSearch";

interface RelevanceSearchArgs {
  createdAtRange?: { end: number; start: number };
  favoritesOnly?: boolean;
  folderId?: Id<"folders">;
  folderQuery?: string;
  hexFilters?: string[];
  hueFilters?: string[];
  searchQuery?: string;
  showArchivedOnly?: boolean;
  showTrashOnly?: boolean;
  sort?: string;
  styleFilters?: string[];
  tag?: string;
  types?: string[];
}

/**
 * Best match for a grid search. Under `sort: "relevance"` it asks the server
 * to score the search's top results and holds the first paint up to
 * `RELEVANCE_HOLD_MS`. Scores in time order the grid; scores that land later
 * are kept for the next time, and this search stays in its unscored order,
 * so cards never move under the person. Every search input counts: changing
 * a filter starts a new request, since it changes which cards are on top.
 */
export function useRelevanceRanking(
  args: RelevanceSearchArgs & { enabled?: boolean }
): { holding: boolean; useRelevanceScores: boolean } {
  const requestRelevanceScores = useAction(
    api.search.relevanceActions.requestRelevanceScores
  );
  const { enabled = true, ...searchArgs } = args;
  const active =
    enabled &&
    searchArgs.sort === "relevance" &&
    semanticSearchText(searchArgs.searchQuery ?? "", searchArgs.folderQuery) !==
      "";
  const requestKey = active ? JSON.stringify(searchArgs) : null;
  const [decided, setDecided] = useState<{
    key: string;
    useScores: boolean;
  } | null>(null);

  useEffect(() => {
    if (!requestKey) {
      return;
    }
    let settled = false;
    const decide = (useScores: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      setDecided({ key: requestKey, useScores });
    };
    const timeout = setTimeout(() => decide(false), RELEVANCE_HOLD_MS);
    // Late, failed or rate-limited, the search keeps its unscored order.
    requestRelevanceScores(JSON.parse(requestKey))
      .then(({ outcome }) => decide(outcome === "ok"))
      .catch(() => decide(false));
    return () => {
      settled = true;
      clearTimeout(timeout);
    };
  }, [requestKey, requestRelevanceScores]);

  if (!requestKey) {
    return { holding: false, useRelevanceScores: false };
  }
  return decided?.key === requestKey
    ? { holding: false, useRelevanceScores: decided.useScores }
    : { holding: true, useRelevanceScores: false };
}
