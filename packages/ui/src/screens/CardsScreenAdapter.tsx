"use client";

import type { ReactNode } from "react";
import type { AddCardFormProps } from "../components/forms";
import { useCardQueryParamState } from "../hooks/useCardQueryParamState";
import type { LibraryView } from "../lib/libraryViews";
import type { SearchUrlState } from "../lib/searchUrlState";
import { CardsScreen, type SearchUrlChange } from "./CardsScreen";

interface CardsScreenAdapterProps {
  cardIdFromUrl: string | null;
  contentContainerClassName?: string;
  headerLeading?: ReactNode;
  onNavigateView?: (view: LibraryView) => void;
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
  cardIdFromUrl,
  contentContainerClassName,
  onUpgrade,
  pushCardId,
  replaceCardId,
  headerLeading,
  onNavigateView,
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
      contentContainerClassName={contentContainerClassName}
      headerLeading={headerLeading}
      onCloseCard={closeCard}
      onNavigateView={onNavigateView}
      onOpenCard={openCard}
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
