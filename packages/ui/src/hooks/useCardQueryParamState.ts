import { useCallback, useEffect, useState } from "react";

export interface UseCardQueryParamStateOptions {
  cardIdFromUrl: string | null;
  pushCardId: (cardId: string) => void;
  replaceCardId: (cardId: string | null) => void;
}

export interface UseCardQueryParamStateResult {
  closeCard: () => void;
  openCard: (cardId: string) => void;
  selectedCardId: string | null;
}

export function normalizeCardQueryId(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function useCardQueryParamState({
  cardIdFromUrl,
  pushCardId,
  replaceCardId,
}: UseCardQueryParamStateOptions): UseCardQueryParamStateResult {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(() =>
    normalizeCardQueryId(cardIdFromUrl)
  );

  useEffect(() => {
    setSelectedCardId(normalizeCardQueryId(cardIdFromUrl));
  }, [cardIdFromUrl]);

  const openCard = useCallback(
    (cardId: string) => {
      const nextCardId = normalizeCardQueryId(cardId);
      if (!nextCardId || selectedCardId === nextCardId) {
        return;
      }

      setSelectedCardId(nextCardId);
      pushCardId(nextCardId);
    },
    [pushCardId, selectedCardId]
  );

  const closeCard = useCallback(() => {
    if (selectedCardId === null) {
      return;
    }

    setSelectedCardId(null);
    replaceCardId(null);
  }, [replaceCardId, selectedCardId]);

  return {
    selectedCardId,
    openCard,
    closeCard,
  };
}
