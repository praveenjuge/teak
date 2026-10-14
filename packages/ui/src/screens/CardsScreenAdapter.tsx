"use client";

import type { ReactNode } from "react";
import type { AddCardFormProps } from "../components/forms";
import { useCardQueryParamState } from "../hooks/useCardQueryParamState";
import type { LibraryView } from "../lib/libraryViews";
import type { SearchUrlState } from "../lib/searchUrlState";
import { CardsScreen, type SearchUrlChange } from "./CardsScreen";

interface CardsScreenAdapterProps {
  addToFolderId?: string;
  cardIdFromUrl: string | null;
  contentContainerClassName?: string;
  folderId?: string;
  headerLeading?: ReactNode;
  onAddCardsToFolder?: (folderId: string) => void;
  onAddToFolderDone?: (folderId: string, added: boolean) => void;
  onNavigateView?: (view: LibraryView) => void;
  onOpenFolder?: (folderId: string) => void;
  onSearchUrlStateChange?: (
    state: SearchUrlState,
    change: SearchUrlChange
  ) => void;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  pushCardId: (cardId: string | null) => void;
  replaceCardId: (cardId: string | null) => void;
  searchUrlState?: SearchUrlState;
  toastIdPrefix?: string;
  UpgradeLinkComponent?: AddCardFormProps["UpgradeLinkComponent"];
  upgradeUrl: string;
  view?: LibraryView;
}

export function CardsScreenAdapter({
  addToFolderId,
  cardIdFromUrl,
  folderId,
  onAddCardsToFolder,
  onAddToFolderDone,
  contentContainerClassName,
  onUpgrade,
  pushCardId,
  replaceCardId,
  headerLeading,
  onNavigateView,
  onOpenFolder,
  searchUrlState,
  onSearchUrlStateChange,
  toastIdPrefix,
  UpgradeLinkComponent,
  upgradeUrl,
  view,
}: CardsScreenAdapterProps) {
  const { selectedCardId, openCard, closeCard } = useCardQueryParamState({
    cardIdFromUrl,
    pushCardId,
    replaceCardId,
  });

  return (
    <CardsScreen
      addToFolderId={addToFolderId}
      contentContainerClassName={contentContainerClassName}
      folderId={folderId}
      headerLeading={headerLeading}
      onAddCardsToFolder={onAddCardsToFolder}
      onAddToFolderDone={onAddToFolderDone}
      onCloseCard={closeCard}
      onNavigateView={onNavigateView}
      onOpenCard={openCard}
      onOpenFolder={onOpenFolder}
      onSearchUrlStateChange={onSearchUrlStateChange}
      onUpgrade={onUpgrade}
      searchUrlState={searchUrlState}
      selectedCardId={selectedCardId}
      toastIdPrefix={toastIdPrefix}
      UpgradeLinkComponent={UpgradeLinkComponent}
      upgradeUrl={upgradeUrl}
      view={view}
    />
  );
}
