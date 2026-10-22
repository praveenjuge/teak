import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCardQueryParamStateOptions {
  cardIdFromUrl: string | null;
  /**
   * Goes Back from the open card's history entry to the list behind it.
   * Returns false when it can't, and the card closes by replacing the URL.
   */
  popCardEntry?: () => boolean;
  pushCardId: (cardId: string) => void;
  replaceCardId: (cardId: string | null) => void;
}

export interface CloseCardOptions {
  /**
   * Replace the URL instead of going Back, for a close that changes the
   * search right after: a Back would land after that change.
   */
  replace?: boolean;
}

export interface UseCardQueryParamStateResult {
  closeCard: (options?: CloseCardOptions) => void;
  openCard: (cardId: string) => void;
  selectedCardId: string | null;
  switchCard: (cardId: string) => void;
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
  popCardEntry,
  pushCardId,
  replaceCardId,
}: UseCardQueryParamStateOptions): UseCardQueryParamStateResult {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(() =>
    normalizeCardQueryId(cardIdFromUrl)
  );
  // The card this page put in the URL, and whether the entry behind it is
  // the list, so closing can go Back instead of stacking another list entry.
  const expectedCardIdRef = useRef(normalizeCardQueryId(cardIdFromUrl));
  const openedOverListRef = useRef<boolean>(false);

  useEffect(() => {
    const urlCardId = normalizeCardQueryId(cardIdFromUrl);
    if (urlCardId !== expectedCardIdRef.current) {
      // Back, Forward or a link moved the URL: what's behind it is unknown.
      expectedCardIdRef.current = urlCardId;
      openedOverListRef.current = false;
    }
    setSelectedCardId(urlCardId);
  }, [cardIdFromUrl]);

  const openCard = useCallback(
    (cardId: string) => {
      const nextCardId = normalizeCardQueryId(cardId);
      if (!nextCardId || selectedCardId === nextCardId) {
        return;
      }

      openedOverListRef.current = selectedCardId === null;
      expectedCardIdRef.current = nextCardId;
      setSelectedCardId(nextCardId);
      pushCardId(nextCardId);
    },
    [pushCardId, selectedCardId]
  );

  const switchCard = useCallback(
    (cardId: string) => {
      const nextCardId = normalizeCardQueryId(cardId);
      if (!nextCardId || selectedCardId === nextCardId) {
        return;
      }

      expectedCardIdRef.current = nextCardId;
      setSelectedCardId(nextCardId);
      replaceCardId(nextCardId);
    },
    [replaceCardId, selectedCardId]
  );

  const closeCard = useCallback(
    (options?: CloseCardOptions) => {
      if (selectedCardId === null) {
        return;
      }

      const backToList = openedOverListRef.current && !options?.replace;
      openedOverListRef.current = false;
      expectedCardIdRef.current = null;
      setSelectedCardId(null);
      if (backToList && popCardEntry?.()) {
        return;
      }
      replaceCardId(null);
    },
    [popCardEntry, replaceCardId, selectedCardId]
  );

  return {
    selectedCardId,
    openCard,
    closeCard,
    switchCard,
  };
}
