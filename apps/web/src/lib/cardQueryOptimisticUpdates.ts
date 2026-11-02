import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { combineSearchQueries, filterLocalCards } from "@teak/convex/shared";
import { extractUrlFromContent } from "@teak/convex/shared/utils/linkDetection";
import { urlKey } from "@teak/convex/shared/utils/urlKey";
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
  if (args.excludePinned && card.pinPosition !== undefined) {
    return false;
  }
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

  updateCardsInDetailQueries(localStore, cardIds, updater);
}

/**
 * The open card dialog reads its card on its own, so a quick second edit
 * there (a tag, a favorite) builds on the first instead of the stale card.
 * A card the update removes stays as it was: the dialog decides when it
 * closes, not a list.
 */
function updateCardsInDetailQueries(
  localStore: OptimisticLocalStore,
  cardIds: ReadonlySet<string>,
  updater: (card: Doc<"cards">) => Doc<"cards"> | null
) {
  for (const { args, value } of localStore.getAllQueries(
    api.cards.getCardByUrlId
  )) {
    if (!(value && cardIds.has(value._id))) {
      continue;
    }
    const nextCard = updater(value as Doc<"cards">);
    if (nextCard) {
      localStore.setQuery(api.cards.getCardByUrlId, args, {
        ...value,
        ...nextCard,
      });
    }
  }
}

const listsNewestFirst = (sort: SearchFilterArgs["sort"]) =>
  sort === undefined || sort === "newest";

export function addCardToSearchQueries(
  localStore: OptimisticLocalStore,
  newCard: Doc<"cards">
) {
  for (const { args, value } of localStore.getAllQueries(
    api.cards.searchCards
  )) {
    if (value !== undefined && cardMatchesSearchQuery(newCard, args)) {
      localStore.setQuery(api.cards.searchCards, args, [newCard, ...value]);
    }
  }

  // The grid reads pages; a new card belongs on the first page of a list
  // ordered newest first, not inside a ranked search.
  for (const { args, value } of localStore.getAllQueries(
    api.cards.searchCardsPaginated
  )) {
    if (
      value !== undefined &&
      args.paginationOpts.cursor === null &&
      listsNewestFirst(args.sort) &&
      !args.searchQuery?.trim() &&
      cardMatchesSearchQuery(newCard, args)
    ) {
      localStore.setQuery(api.cards.searchCardsPaginated, args, {
        ...value,
        page: [newCard, ...(value.page as Doc<"cards">[])],
      });
    }
  }
}

/** The link in content that is only a link, as a re-save would match it. */
const bareLinkKey = (content: string): string | undefined => {
  const { url, cleanedContent } = extractUrlFromContent(content);
  return url && cleanedContent === url ? (urlKey(url) ?? url) : undefined;
};

const linkKeyOf = (card: Doc<"cards">) =>
  card.urlKey ?? (card.url ? (urlKey(card.url) ?? card.url) : undefined);

function findSavedLink(
  localStore: OptimisticLocalStore,
  key: string
): Doc<"cards"> | undefined {
  const matches = (card: Doc<"cards">) =>
    card.type === "link" && !card.isDeleted && linkKeyOf(card) === key;
  for (const { value } of localStore.getAllQueries(api.cards.searchCards)) {
    const found = (value as Doc<"cards">[] | undefined)?.find(matches);
    if (found) {
      return found;
    }
  }
  for (const { value } of localStore.getAllQueries(
    api.cards.searchCardsPaginated
  )) {
    const found = (value?.page as Doc<"cards">[] | undefined)?.find(matches);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Shows a note or link being saved from the composer. A bare link already in
 * a loaded list is saved again on the server, which moves it to the top, so
 * it moves up here too instead of a second tile appearing beside it; any
 * other capture gets a placeholder tile at the top. Convex drops both once
 * the save's result arrives.
 */
export function addCaptureToSearchQueries(
  localStore: OptimisticLocalStore,
  capture: { content: string; id: Id<"cards">; now: number }
) {
  const { content, id, now } = capture;
  const key = bareLinkKey(content);
  const saved = key ? findSavedLink(localStore, key) : undefined;
  if (!saved) {
    addCardToSearchQueries(localStore, {
      _id: id,
      _creationTime: now,
      userId: "",
      content,
      type: "text",
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  updateCardInSearchQueries(localStore, saved._id, () => null);
  addCardToSearchQueries(localStore, {
    ...saved,
    savedAt: now,
    updatedAt: now,
    isArchived: undefined,
    archivedAt: undefined,
  });
}
