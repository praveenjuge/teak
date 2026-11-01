import { formatSearchQualifier } from "@teak/convex/shared";
import type { CardType } from "@teak/convex/shared/constants";
import { useCallback } from "react";

export interface UseCardModalFilterActionsOptions {
  addFilter: (filter: CardType) => void;
  /** Adds a search qualifier chip, as typing it into the search box does. */
  addQualifier: (qualifier: string) => void;
  onCloseModal: () => void;
}

/**
 * The `tag:` qualifier for a tag, quoted when it holds spaces or quotes, so a
 * tag chip filters by that exact tag rather than searching its words.
 */
export const tagQualifier = (tag: string) =>
  formatSearchQualifier({ key: "tag", value: tag.trim() });

export function createCardModalFilterActions({
  addFilter,
  addQualifier,
  onCloseModal,
}: UseCardModalFilterActionsOptions) {
  return {
    handleCardTypeClick: (cardType: string) => {
      onCloseModal();
      addFilter(cardType as CardType);
    },
    handleTagClick: (tag: string) => {
      if (!tag.trim()) {
        return;
      }
      onCloseModal();
      addQualifier(tagQualifier(tag));
    },
  };
}

export function useCardModalFilterActions({
  addFilter,
  addQualifier,
  onCloseModal,
}: UseCardModalFilterActionsOptions) {
  const handleCardTypeClick = useCallback(
    (cardType: string) =>
      createCardModalFilterActions({
        addFilter,
        addQualifier,
        onCloseModal,
      }).handleCardTypeClick(cardType),
    [addFilter, addQualifier, onCloseModal]
  );

  const handleTagClick = useCallback(
    (tag: string) =>
      createCardModalFilterActions({
        addFilter,
        addQualifier,
        onCloseModal,
      }).handleTagClick(tag),
    [addFilter, addQualifier, onCloseModal]
  );

  return {
    handleCardTypeClick,
    handleTagClick,
  };
}
