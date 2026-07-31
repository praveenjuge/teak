import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardActionsConfig,
  createCardActions,
} from "@teak/convex/shared/hooks/useCardActions";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { updateCardInSearchQueries } from "./cardQueryOptimisticUpdates";

function updateSingleCardQuery(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards">
) {
  const currentCard = localStore.getQuery(api.cards.getCard, { id: cardId });
  if (currentCard) {
    localStore.setQuery(
      api.cards.getCard,
      { id: cardId },
      updater(currentCard)
    );
  }
}

export function useCardActions(config: CardActionsConfig = {}) {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(
    api.cards.updateCardField
  ).withOptimisticUpdate((localStore, args) => {
    const { cardId, field, value, tagToRemove } = args;

    const now = Date.now();

    switch (field) {
      case "isFavorited": {
        const toggleFavorite = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          isFavorited: !card.isFavorited,
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, cardId, toggleFavorite);
        updateSingleCardQuery(localStore, cardId, toggleFavorite);
        break;
      }

      case "delete": {
        const markDeleted = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          isDeleted: true,
          deletedAt: now,
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, cardId, markDeleted);
        updateSingleCardQuery(localStore, cardId, markDeleted);
        break;
      }

      case "restore": {
        const markRestored = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          isDeleted: undefined,
          deletedAt: undefined,
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, cardId, markRestored);
        updateSingleCardQuery(localStore, cardId, markRestored);
        break;
      }

      case "tags": {
        const updateTags = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          tags: Array.isArray(value) && value.length > 0 ? value : undefined,
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, cardId, updateTags);
        updateSingleCardQuery(localStore, cardId, updateTags);
        break;
      }

      case "removeAiTag": {
        if (!tagToRemove) {
          break;
        }
        const removeAiTag = (card: Doc<"cards">): Doc<"cards"> => {
          const updatedAiTags = card.aiTags?.filter(
            (tag) => tag !== tagToRemove
          );
          return {
            ...card,
            aiTags:
              updatedAiTags && updatedAiTags.length > 0
                ? updatedAiTags
                : undefined,
            updatedAt: now,
          };
        };
        updateCardInSearchQueries(localStore, cardId, removeAiTag);
        updateSingleCardQuery(localStore, cardId, removeAiTag);
        break;
      }

      case "content":
      case "url":
      case "notes":
      case "aiSummary": {
        const updateTextField = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          [field]:
            typeof value === "string" ? value.trim() || undefined : value,
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, cardId, updateTextField);
        updateSingleCardQuery(localStore, cardId, updateTextField);
        break;
      }

      default:
        break;
    }
  });

  const cardActions = createCardActions(
    { permanentDeleteCard, updateCardField },
    config
  );

  return {
    ...cardActions,
    handleBulkDeleteCards: (cardIds: Id<"cards">[]) =>
      cardActions.handleBulkDeleteCards(cardIds),
  };
}
