import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { combineSearchQueries, filterLocalCards } from "@teak/convex/shared";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";

type SearchCardsPaginatedArgs = FunctionArgs<
  typeof api.cards.searchCardsPaginated
>;
type SearchFilterArgs = Omit<SearchCardsPaginatedArgs, "paginationOpts">;

export function cardMatchesSearchQuery(
  card: Doc<"cards">,
  args: SearchFilterArgs
): boolean {
  const isSmartFolder = args.folderQuery !== undefined;
  if (
    args.folderId &&
    !isSmartFolder &&
    !(card.folderIds ?? []).includes(args.folderId)
  ) {
    return false;
  }
  const searchTerms = isSmartFolder
    ? combineSearchQueries(args.folderQuery ?? "", args.searchQuery ?? "")
    : args.searchQuery;
  if (searchTerms === null) {
    return false;
  }
  return (
    filterLocalCards([card], {
      createdAtRange: args.createdAtRange,
      favoritesOnly: args.favoritesOnly,
      hexFilters: args.hexFilters,
      hueFilters: args.hueFilters,
      searchTerms,
      showArchivedOnly: args.showArchivedOnly,
      showTrashOnly: args.showTrashOnly,
      styleFilters: args.styleFilters,
      tag: args.tag,
      // Every card here came back from the server for these args, so a match
      // on text the client lacks (a PDF's text, a meaning match) still holds.
      textMatchedByServer: true,
      types: args.types,
    }).length === 1
  );
}

export function updateCardInSearchQueries(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null
) {
  let updatedCard: Doc<"cards"> | null | undefined;
  updateCardsInSearchQueries(localStore, new Set([cardId]), (card) => {
    const nextCard = updater(card);
    updatedCard ??= nextCard;
    return nextCard;
  });
  return updatedCard;
}

export function updateCardsInSearchQueries(
  localStore: OptimisticLocalStore,
  cardIds: ReadonlySet<string>,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null
) {
  const updateCards = (
    cards: Doc<"cards">[],
    args: SearchFilterArgs
  ): Doc<"cards">[] =>
    cards
      .map((card) => (cardIds.has(card._id) ? updater(card) : card))
      .filter((card): card is Doc<"cards"> => card !== null)
      .filter((card) => cardMatchesSearchQuery(card, args));

  for (const { args, value } of localStore.getAllQueries(
    api.cards.searchCards
  )) {
    if (value === undefined) {
      continue;
    }

    localStore.setQuery(
      api.cards.searchCards,
      args,
      updateCards(value as Doc<"cards">[], args)
    );
  }

  for (const { args, value } of localStore.getAllQueries(
    api.cards.searchCardsPaginated
  )) {
    if (value === undefined) {
      continue;
    }

    localStore.setQuery(api.cards.searchCardsPaginated, args, {
      ...value,
      page: updateCards(value.page as Doc<"cards">[], args),
    });
  }
}
