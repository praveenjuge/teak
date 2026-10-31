import { api } from "@teak/convex";
import { useMemo } from "react";
import { useQuery } from "@/lib/convexQueryHooks";
import type { SearchSuggestionSources } from "../components/search/searchSuggestions";
import { type FolderSummary, manualFolders } from "../lib/folders";

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
