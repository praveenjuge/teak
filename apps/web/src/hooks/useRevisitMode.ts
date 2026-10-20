import { useCallback, useEffect, useRef } from "react";
import type { BulkCardAction, BulkRunResult } from "../lib/bulkCardActions";
import type { LibrarySort } from "../lib/searchUrlState";
import type { BulkActionOptions } from "./useBulkCardActions";

export interface UseRevisitModeOptions {
  archiveOrTrash: boolean;
  cardOpen: boolean;
  empty: boolean;
  librarySort: LibrarySort;
  replaceNextSortChange: () => void;
  reshuffle: () => void;
  runBulkAction: (
    action: BulkCardAction,
    cardIds: string[],
    options?: BulkActionOptions
  ) => Promise<BulkRunResult>;
  setSort: (sort: LibrarySort) => void;
  urlDriven: boolean;
}

export function useRevisitMode({
  archiveOrTrash,
  cardOpen,
  empty,
  librarySort,
  replaceNextSortChange,
  reshuffle,
  runBulkAction,
  setSort,
  urlDriven,
}: UseRevisitModeOptions) {
  const pickedFrom = useRef<LibrarySort | null>(null);
  const openedCard = useRef(false);
  const revisiting = librarySort === "revisit" && !archiveOrTrash;
  useEffect(() => {
    if (librarySort !== "revisit") {
      pickedFrom.current = null;
      openedCard.current = false;
    } else if (cardOpen) {
      openedCard.current = true;
    }
  }, [cardOpen, librarySort]);

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
    if (previous !== null && urlDriven && !openedCard.current) {
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
