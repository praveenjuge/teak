"use client";

import { useCallback, useRef } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { useCardQueryParamState } from "../hooks/useCardQueryParamState";
import { useLibraryUrl } from "../hooks/useLibraryUrl";
import type { CardsVisualFilters } from "../lib/cardsSearchState";
import type { LibraryView } from "../lib/libraryViews";
import { CardsReadBoundary } from "./CardsReadBoundary";
import { CardsScreen } from "./CardsScreen";

/** The library, a view of it or a folder, driven by its URL. */
export function LibraryScreen({
  folderId,
  view = "all",
}: {
  folderId?: string;
  view?: LibraryView;
}) {
  const url = useLibraryUrl({ folderId });
  const { selectedCardId, openCard, closeCard, switchCard } =
    useCardQueryParamState(url);
  // A read that failed and is tried again keeps the colors and dates picked.
  const visualFiltersRef = useRef<CardsVisualFilters | undefined>(undefined);
  const rememberVisualFilters = useCallback((filters: CardsVisualFilters) => {
    visualFiltersRef.current = filters;
  }, []);
  const headerLeading = <SidebarToggle className="-ml-2" />;

  return (
    <CardsReadBoundary
      headerLeading={headerLeading}
      resetKey={JSON.stringify([
        folderId,
        view,
        url.addToFolderId,
        url.searchUrlState,
      ])}
    >
      {(retryKey) => (
        <CardsScreen
          addToFolderId={url.addToFolderId}
          composerDraft={url.composerDraft}
          focusComposer={url.focusComposer}
          folderId={folderId}
          headerLeading={headerLeading}
          initialVisualFilters={retryKey ? visualFiltersRef.current : undefined}
          onAddCardsToFolder={url.onAddCardsToFolder}
          onAddToFolderDone={url.onAddToFolderDone}
          onCloseCard={closeCard}
          onFocusComposerHandled={url.onFocusComposerHandled}
          onNavigateView={url.onNavigateView}
          onOpenCard={openCard}
          onOpenFolder={url.onOpenFolder}
          onSearchUrlStateChange={url.onSearchUrlStateChange}
          onSwitchCard={switchCard}
          onVisualFiltersChange={rememberVisualFilters}
          queryRetryKey={retryKey}
          searchUrlState={url.searchUrlState}
          selectedCardId={selectedCardId}
          view={view}
        />
      )}
    </CardsReadBoundary>
  );
}
