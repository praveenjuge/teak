import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { LibraryView } from "../lib/libraryViews";

export function useViewHasHiddenCards({
  asks,
  folderId,
  view,
}: {
  asks: boolean;
  folderId?: Id<"folders">;
  view?: LibraryView;
}): boolean {
  const args = folderId ? { folderId } : { view: view ?? "all" };
  return useQuery(api.cards.viewHasHiddenCards, asks ? args : "skip") === true;
}
