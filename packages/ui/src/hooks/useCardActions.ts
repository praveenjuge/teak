import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardActionsConfig,
  createCardActions,
} from "@teak/convex/shared/hooks/useCardActions";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";

const cardMatchesQueryArgs = (card: Doc<"cards">, args: any): boolean => {
  const isTrashQuery = Boolean(args.showTrashOnly);
  if (isTrashQuery ? card.isDeleted !== true : card.isDeleted === true) {
    return false;
  }

  if (args.types?.length && !args.types.includes(card.type)) {
    return false;
  }

  if (args.favoritesOnly && card.isFavorited !== true) {
    return false;
  }

  if (args.styleFilters?.length) {
    if (card.type !== "image") {
      return false;
    }

    const styleSet = new Set(card.visualStyles ?? []);
    if (!args.styleFilters.some((style: string) => styleSet.has(style))) {
      return false;
    }
  }

  if (args.hueFilters?.length) {
    if (!(card.type === "image" || card.type === "palette")) {
      return false;
    }

    const hueSet = new Set(card.colorHues ?? []);
    if (!args.hueFilters.some((hue: string) => hueSet.has(hue))) {
      return false;
    }
  }

  if (args.hexFilters?.length) {
    if (!(card.type === "image" || card.type === "palette")) {
      return false;
    }

    const hexSet = new Set(card.colorHexes ?? []);
    if (!args.hexFilters.some((hex: string) => hexSet.has(hex))) {
      return false;
    }
  }

  return true;
};

function updateCardInSearchQueries(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null
) {
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined) {
      const updatedCards = (value as Doc<"cards">[])
        .map((card: Doc<"cards">) =>
          card._id === cardId ? updater(card) : card
        )
        .filter(
          (card: Doc<"cards"> | null): card is Doc<"cards"> => card !== null
        )
        .filter((card: Doc<"cards">) => cardMatchesQueryArgs(card, args));
      localStore.setQuery(api.cards.searchCards, args, updatedCards);
    }
  }
}

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
        const markDeleted = (card: Doc<"cards">): Doc<"cards"> | null => {
          return {
            ...card,
            isDeleted: true,
            deletedAt: now,
            updatedAt: now,
          };
        };
        const allQueries = localStore.getAllQueries(api.cards.searchCards);
        for (const { args: queryArgs, value: cards } of allQueries) {
          if (cards !== undefined) {
            const typedCards = cards as Doc<"cards">[];
            if (queryArgs.showTrashOnly) {
              const updatedCards = typedCards.map((card: Doc<"cards">) =>
                card._id === cardId ? markDeleted(card)! : card
              );
              localStore.setQuery(
                api.cards.searchCards,
                queryArgs,
                updatedCards
              );
            } else {
              const filteredCards = typedCards.filter(
                (card: Doc<"cards">) =>
                  card._id !== cardId && cardMatchesQueryArgs(card, queryArgs)
              );
              localStore.setQuery(
                api.cards.searchCards,
                queryArgs,
                filteredCards
              );
            }
          }
        }
        updateSingleCardQuery(
          localStore,
          cardId,
          markDeleted as (card: Doc<"cards">) => Doc<"cards">
        );
        break;
      }

      case "restore": {
        const markRestored = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          isDeleted: undefined,
          deletedAt: undefined,
          updatedAt: now,
        });
        const allQueriesRestore = localStore.getAllQueries(
          api.cards.searchCards
        );
        for (const { args: queryArgs, value: cards } of allQueriesRestore) {
          if (cards !== undefined) {
            const typedCards = cards as Doc<"cards">[];
            if (queryArgs.showTrashOnly) {
              const filteredCards = typedCards.filter(
                (card: Doc<"cards">) => card._id !== cardId
              );
              localStore.setQuery(
                api.cards.searchCards,
                queryArgs,
                filteredCards
              );
            } else {
              const filteredCards = typedCards.filter((card: Doc<"cards">) =>
                cardMatchesQueryArgs(card, queryArgs)
              );
              localStore.setQuery(
                api.cards.searchCards,
                queryArgs,
                filteredCards
              );
            }
          }
        }
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
    handleBulkDeleteCards: async (cardIds: Id<"cards">[]) => {
      return cardActions.handleBulkDeleteCards(cardIds);
    },
  };
}
