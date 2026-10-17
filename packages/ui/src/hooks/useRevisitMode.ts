import { useCallback, useEffect, useRef } from "react";
import type { BulkCardAction, BulkRunResult } from "../lib/bulkCardActions";
import type { LibrarySort } from "../lib/searchUrlState";
import type { BulkActionOptions } from "./useBulkCardActions";

export interface UseRevisitModeOptions {
  /** Archive and Trash leave Revisit out: archiving makes no sense there. */
  archiveOrTrash: boolean;
  /** The view shows no cards, so there is nothing to deal. */
  empty: boolean;
  librarySort: LibrarySort;
  /** Makes the next sort change replace the URL instead of adding to it. */
  replaceNextSortChange: () => void;
  reshuffle: () => void;
  runBulkAction: (
    action: BulkCardAction,
    cardIds: string[],
    options?: BulkActionOptions
  ) => Promise<BulkRunResult>;
  setSort: (sort: LibrarySort) => void;
  /** The search lives in the page URL, so Back can close the deck. */
  urlDriven: boolean;
}

/**
 * How a library view enters and leaves Revisit. Picking it from the menu
 * adds a history entry, so leaving goes Back to the order before; a deck
 * opened from a link has no such entry, so leaving replaces the URL with
 * the default order. Start over replaces too, so Back never lands on an
 * old seed.
 */
export function useRevisitMode({
  archiveOrTrash,
  empty,
  librarySort,
  replaceNextSortChange,
  reshuffle,
  runBulkAction,
  setSort,
  urlDriven,
}: UseRevisitModeOptions) {
  // The order Revisit was picked from in this page; null when opened from
  // the URL (a reload or a shared link).
  const pickedFrom = useRef<LibrarySort | null>(null);
  const revisiting = librarySort === "revisit" && !archiveOrTrash;
  useEffect(() => {
    if (librarySort !== "revisit") {
      pickedFrom.current = null;
    }
  }, [librarySort]);

  const onSortChange = useCallback(
    (next: LibrarySort) => {
      if (next === "revisit" && librarySort !== "revisit") {
        pickedFrom.current = librarySort;
      }
      setSort(next);
    },
    [librarySort, setSort]
  );

  const exit = useCallback(() => {
    const previous = pickedFrom.current;
    pickedFrom.current = null;
    if (previous !== null && urlDriven) {
      window.history.back();
      return;
    }
    replaceNextSortChange();
    setSort(previous ?? "newest");
  }, [replaceNextSortChange, setSort, urlDriven]);

  const startOver = useCallback(() => {
    replaceNextSortChange();
    reshuffle();
  }, [replaceNextSortChange, reshuffle]);

  const onArchive = useCallback(
    async (cardId: string) =>
      (await runBulkAction("archive", [cardId])).failedIds.length === 0,
    [runBulkAction]
  );
  // Z is already an undo: it says nothing unless it fails.
  const onUnarchive = useCallback(
    async (cardId: string) =>
      (await runBulkAction("unarchive", [cardId], { silent: true })).failedIds
        .length === 0,
    [runBulkAction]
  );

  let offer: "empty" | "ready" | undefined;
  if (!archiveOrTrash) {
    offer = empty ? "empty" : "ready";
  }

  return {
    exit,
    offer,
    onArchive,
    onSortChange,
    onUnarchive,
    revisiting,
    startOver,
  };
}
