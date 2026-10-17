import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { LibraryView } from "../lib/libraryViews";

/**
 * Whether an empty library view or folder is empty because its cards are
 * hidden: one row read, asked only while the view shows nothing, so the
 * empty state can say how to see them.
 */
export function useViewHasHiddenCards({
  asks,
  folderId,
  view,
}: {
  /** The view shows no cards and nothing narrows it. */
  asks: boolean;
  folderId?: Id<"folders">;
  view?: LibraryView;
}): boolean {
  const args = folderId ? { folderId } : { view: view ?? "all" };
  return useQuery(api.cards.viewHasHiddenCards, asks ? args : "skip") === true;
}
