import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { filterLocalCards } from "@teak/convex/shared";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";

type SearchCardsArgs = FunctionArgs<typeof api.cards.searchCards>;

export function cardMatchesSearchQuery(
  card: Doc<"cards">,
  args: SearchCardsArgs
): boolean {
  return (
    filterLocalCards([card], {
      createdAtRange: args.createdAtRange,
      favoritesOnly: args.favoritesOnly,
      hexFilters: args.hexFilters,
      hueFilters: args.hueFilters,
      searchTerms: args.searchQuery,
      showTrashOnly: args.showTrashOnly,
      styleFilters: args.styleFilters,
      types: args.types,
    }).length === 1
  );
}

export function updateCardInSearchQueries(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null
) {
  for (const { args, value } of localStore.getAllQueries(
    api.cards.searchCards
  )) {
    if (value === undefined) {
      continue;
    }

    const updatedCards = (value as Doc<"cards">[])
      .map((card) => (card._id === cardId ? updater(card) : card))
      .filter((card): card is Doc<"cards"> => card !== null)
      .filter((card) => cardMatchesSearchQuery(card, args));

    localStore.setQuery(api.cards.searchCards, args, updatedCards);
  }
}
