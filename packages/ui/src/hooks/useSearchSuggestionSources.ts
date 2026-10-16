import { api } from "@teak/convex";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useMemo } from "react";
import type { SearchSuggestionSources } from "../components/search/searchSuggestions";
import { type FolderSummary, manualFolders } from "../lib/folders";

/**
 * Tags, folders and the most saved sites for the search box's suggestions,
 * from the cached lists the sidebar already reads. Nothing is read until
 * `enabled`, which the screen turns on when the search box is first used.
 */
export function useSearchSuggestionSources(
  enabled: boolean
): SearchSuggestionSources {
  const skip = enabled ? {} : "skip";
  const tagSummary = useQuery(api.tags.listTagSummary, skip);
  const folders: FolderSummary[] | undefined = useQuery(
    api.folders.listFolders,
    skip
  );
  const sites = useQuery(
    api.cards.listTopSites,
    enabled ? { limit: 20 } : "skip"
  );
  return useMemo(
    () => ({
      tags: tagSummary?.items,
      folders: folders === undefined ? undefined : manualFolders(folders),
      sites,
    }),
    [folders, sites, tagSummary?.items]
  );
}
