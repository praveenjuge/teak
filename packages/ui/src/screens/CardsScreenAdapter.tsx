"use client";

import type { ReactNode } from "react";
import type { AddCardFormProps } from "../components/forms";
import { useCardQueryParamState } from "../hooks/useCardQueryParamState";
import type { SearchUrlState } from "../lib/searchUrlState";
import { CardsScreen } from "./CardsScreen";

interface CardsScreenAdapterProps {
  cardIdFromUrl: string | null;
  contentContainerClassName?: string;
  onSearchUrlStateChange?: (
    state: SearchUrlState,
    change: { sortChanged: boolean }
  ) => void;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  pushCardId: (cardId: string | null) => void;
  replaceCardId: (cardId: string | null) => void;
  SettingsButton?: ReactNode;
  searchUrlState?: SearchUrlState;
  toastIdPrefix?: string;
  UpgradeLinkComponent?: AddCardFormProps["UpgradeLinkComponent"];
  upgradeUrl: string;
}

export function CardsScreenAdapter({
  cardIdFromUrl,
  contentContainerClassName,
  onUpgrade,
  pushCardId,
  replaceCardId,
  SettingsButton,
  searchUrlState,
  onSearchUrlStateChange,
  toastIdPrefix,
  UpgradeLinkComponent,
  upgradeUrl,
}: CardsScreenAdapterProps) {
  const { selectedCardId, openCard, closeCard } = useCardQueryParamState({
    cardIdFromUrl,
    pushCardId,
    replaceCardId,
  });

  return (
    <CardsScreen
      contentContainerClassName={contentContainerClassName}
      onCloseCard={closeCard}
      onOpenCard={openCard}
      onSearchUrlStateChange={onSearchUrlStateChange}
      onUpgrade={onUpgrade}
      SettingsButton={SettingsButton}
      searchUrlState={searchUrlState}
      selectedCardId={selectedCardId}
      toastIdPrefix={toastIdPrefix}
      UpgradeLinkComponent={UpgradeLinkComponent}
      upgradeUrl={upgradeUrl}
    />
  );
}
