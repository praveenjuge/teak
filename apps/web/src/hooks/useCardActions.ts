import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  createCardActions,
  setSentryCaptureFunction,
  type CardActionsConfig,
} from "@teak/convex/shared/hooks/useCardActions";
import * as Sentry from "@sentry/nextjs";
import { metrics } from "@/lib/metrics";

// Inject Sentry capture function into shared hook
setSentryCaptureFunction((error, context) => {
  Sentry.captureException(error, context);
});

// Helper to update a card in all cached searchCards queries
function updateCardInSearchQueries(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null // return null to remove
) {
  // Get all active searchCards queries and update the card in each
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined) {
      const updatedCards = (value as Doc<"cards">[])
        .map((card: Doc<"cards">) => (card._id === cardId ? updater(card) : card))
        .filter((card: Doc<"cards"> | null): card is Doc<"cards"> => card !== null);
      localStore.setQuery(api.cards.searchCards, args, updatedCards);
    }
  }
}

// Helper to update a single card query (getCard)
function updateSingleCardQuery(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards">
) {
  const currentCard = localStore.getQuery(api.cards.getCard, { id: cardId });
  if (currentCard) {
    localStore.setQuery(api.cards.getCard, { id: cardId }, updater(currentCard));
  }
}

export function useCardActions(config: CardActionsConfig = {}) {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField).withOptimisticUpdate(
    (localStore, args) => {
      const { cardId, field, value, tagToRemove } = args;
       
      const now = Date.now();

      switch (field) {
        case "isFavorited": {
          // Toggle favorite status optimistically
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
          // Soft delete optimistically - remove from non-trash views
          const markDeleted = (card: Doc<"cards">): Doc<"cards"> | null => {
            // Return updated card for trash views, null for regular views
            return {
              ...card,
              isDeleted: true,
              deletedAt: now,
              updatedAt: now,
            };
          };
          // For searchCards, we need to filter out deleted cards from non-trash views
          const allQueries = localStore.getAllQueries(api.cards.searchCards);
          for (const { args: queryArgs, value: cards } of allQueries) {
            if (cards !== undefined) {
              const typedCards = cards as Doc<"cards">[];
              if (queryArgs.showTrashOnly) {
                // In trash view - add/update the deleted card
                const updatedCards = typedCards.map((card: Doc<"cards">) =>
                  card._id === cardId ? markDeleted(card)! : card
                );
                localStore.setQuery(api.cards.searchCards, queryArgs, updatedCards);
              } else {
                // In regular view - remove the deleted card
                const filteredCards = typedCards.filter((card: Doc<"cards">) => card._id !== cardId);
                localStore.setQuery(api.cards.searchCards, queryArgs, filteredCards);
              }
            }
          }
          // Update single card query
          updateSingleCardQuery(localStore, cardId, markDeleted as (card: Doc<"cards">) => Doc<"cards">);
          break;
        }

        case "restore": {
          // Restore optimistically - remove from trash views
          const markRestored = (card: Doc<"cards">): Doc<"cards"> => ({
            ...card,
            isDeleted: undefined,
            deletedAt: undefined,
            updatedAt: now,
          });
          // For searchCards, we need to filter out restored cards from trash views
          const allQueriesRestore = localStore.getAllQueries(api.cards.searchCards);
          for (const { args: queryArgs, value: cards } of allQueriesRestore) {
            if (cards !== undefined) {
              const typedCards = cards as Doc<"cards">[];
              if (queryArgs.showTrashOnly) {
                // In trash view - remove the restored card
                const filteredCards = typedCards.filter((card: Doc<"cards">) => card._id !== cardId);
                localStore.setQuery(api.cards.searchCards, queryArgs, filteredCards);
              } else {
                // In regular view - the card will reappear on query refresh
                // We can't easily add it back without knowing all fields
              }
            }
          }
          // Update single card query
          updateSingleCardQuery(localStore, cardId, markRestored);
          break;
        }

        case "tags": {
          // Update tags optimistically
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
          if (!tagToRemove) break;
          const removeAiTag = (card: Doc<"cards">): Doc<"cards"> => {
            const updatedAiTags = card.aiTags?.filter((tag) => tag !== tagToRemove);
            return {
              ...card,
              aiTags: updatedAiTags && updatedAiTags.length > 0 ? updatedAiTags : undefined,
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
          // Update text fields optimistically
          const updateTextField = (card: Doc<"cards">): Doc<"cards"> => ({
            ...card,
            [field]: typeof value === "string" ? value.trim() || undefined : value,
            updatedAt: now,
          });
          updateCardInSearchQueries(localStore, cardId, updateTextField);
          updateSingleCardQuery(localStore, cardId, updateTextField);
          break;
        }
      }
    }
  );

  // Wrap the config to add metrics tracking
  const wrappedConfig: CardActionsConfig = {
    ...config,
    onDeleteSuccess: (message) => {
      metrics.cardDeleted("unknown"); // Card type not available here
      config.onDeleteSuccess?.(message);
    },
    onRestoreSuccess: (message) => {
      metrics.cardRestored("unknown");
      config.onRestoreSuccess?.(message);
    },
    onPermanentDeleteSuccess: (message) => {
      metrics.cardPermanentlyDeleted("unknown");
      config.onPermanentDeleteSuccess?.(message);
    },
    onError: (error, operation) => {
      metrics.errorOccurred("api", operation);
      config.onError?.(error, operation);
    },
  };

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    wrappedConfig
  );
}
