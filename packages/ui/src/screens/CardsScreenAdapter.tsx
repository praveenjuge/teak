"use client";

import type { ReactNode } from "react";
import type { AddCardFormProps } from "../components/forms";
import { useCardQueryParamState } from "../hooks";
import { CardsScreen } from "./CardsScreen";

interface CardsScreenAdapterProps {
  cardIdFromUrl: string | null;
  contentContainerClassName?: string;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  pushCardId: (cardId: string | null) => void;
  replaceCardId: (cardId: string | null) => void;
  SettingsButton?: ReactNode;
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
      onUpgrade={onUpgrade}
      SettingsButton={SettingsButton}
      selectedCardId={selectedCardId}
      toastIdPrefix={toastIdPrefix}
      UpgradeLinkComponent={UpgradeLinkComponent}
      upgradeUrl={upgradeUrl}
    />
  );
}
