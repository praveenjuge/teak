import type { CardType } from "@teak/convex/shared/constants";
import { useCallback } from "react";

export interface UseCardModalFilterActionsOptions {
  addFilter: (filter: CardType) => void;
  addKeywordTag: (keyword: string) => void;
  onCloseModal: () => void;
}

export function createCardModalFilterActions({
  addFilter,
  addKeywordTag,
  onCloseModal,
}: UseCardModalFilterActionsOptions) {
  return {
    handleCardTypeClick: (cardType: string) => {
      onCloseModal();
      addFilter(cardType as CardType);
    },
    handleTagClick: (tag: string) => {
      onCloseModal();
      addKeywordTag(tag);
    },
  };
}

export function useCardModalFilterActions({
  addFilter,
  addKeywordTag,
  onCloseModal,
}: UseCardModalFilterActionsOptions) {
  const handleCardTypeClick = useCallback(
    (cardType: string) =>
      createCardModalFilterActions({
        addFilter,
        addKeywordTag,
        onCloseModal,
      }).handleCardTypeClick(cardType),
    [addFilter, addKeywordTag, onCloseModal]
  );

  const handleTagClick = useCallback(
    (tag: string) =>
      createCardModalFilterActions({
        addFilter,
        addKeywordTag,
        onCloseModal,
      }).handleTagClick(tag),
    [addFilter, addKeywordTag, onCloseModal]
  );

  return {
    handleCardTypeClick,
    handleTagClick,
  };
}
