import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { combineSearchQueries, filterLocalCards } from "@teak/convex/shared";
import type { BulkCardAction } from "@teak/convex/shared/bulkCardActions";
import { isHiddenTagList, normalizeTagList } from "@teak/convex/shared/tags";
import { extractUrlFromContent } from "@teak/convex/shared/utils/linkDetection";
import { urlKey } from "@teak/convex/shared/utils/urlKey";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { findTag, tagsWithAdded, tagsWithout } from "./cardTags";
import { editPaletteColors } from "./paletteColors";

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
 * The open card dialog and the tag dialog read their card on their own, so a
 * quick second edit there (a tag, a favorite) builds on the first instead of
 * the stale card.
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
  for (const { args, value } of localStore.getAllQueries(api.cards.getCard)) {
    if (!(value && cardIds.has(value._id))) {
      continue;
    }
    const nextCard = updater(value);
    if (nextCard) {
      localStore.setQuery(api.cards.getCard, args, nextCard);
    }
  }
}

type UpdateCardFieldArgs = FunctionArgs<typeof api.cards.updateCardField>;
type BulkUpdateCardsArgs = FunctionArgs<typeof api.cards.bulkUpdateCards>;
export type CardField = UpdateCardFieldArgs["field"];

type FolderAction = Extract<
  BulkCardAction,
  "addToFolder" | "removeFromFolder" | "moveToFolder"
>;

/** One `updateCardField` edit, as a bulk action makes it on the server. */
export interface CardFieldEdit {
  field: CardField;
  tagToRemove?: string;
  value?: UpdateCardFieldArgs["value"];
}

const TEXT_FIELDS = new Set<CardField>([
  "aiSummary",
  "content",
  "metadataTitle",
  "notes",
  "url",
]);

/**
 * The card as `updateCardField` will leave it, or `null` for a field the
 * client leaves to the server. A change the server skips (deleting a card
 * already in Trash) keeps the card as it is.
 */
export function cardAfterFieldUpdate(
  card: Doc<"cards">,
  { field, value, tagToRemove }: CardFieldEdit,
  now: number
): Doc<"cards"> | null {
  switch (field) {
    case "isFavorited":
      return {
        ...card,
        isFavorited: typeof value === "boolean" ? value : !card.isFavorited,
        updatedAt: now,
      };
    case "delete":
      return card.isDeleted
        ? card
        : {
            ...card,
            isDeleted: true,
            deletedAt: now,
            pinPosition: undefined,
            updatedAt: now,
          };
    case "restore":
      return card.isDeleted
        ? {
            ...card,
            isDeleted: undefined,
            deletedAt: undefined,
            updatedAt: now,
          }
        : card;
    case "archive":
      return card.isArchived
        ? card
        : {
            ...card,
            isArchived: true,
            archivedAt: now,
            pinPosition: undefined,
            updatedAt: now,
          };
    case "unarchive":
      return card.isArchived
        ? {
            ...card,
            isArchived: undefined,
            archivedAt: undefined,
            updatedAt: now,
          }
        : card;
    case "done":
    case "undone":
      return card.type === "link"
        ? {
            ...card,
            completedAt:
              field === "done" ? (card.completedAt ?? now) : undefined,
            updatedAt: now,
          }
        : card;
    case "tags": {
      const normalized = Array.isArray(value)
        ? normalizeTagList(value as string[])
        : [];
      const tags = normalized.length > 0 ? normalized : undefined;
      return {
        ...card,
        tags,
        isHidden: isHiddenTagList(tags) ? true : undefined,
        updatedAt: now,
      };
    }
    case "removeAiTag": {
      if (!tagToRemove) {
        return null;
      }
      const aiTags = card.aiTags?.filter((tag) => tag !== tagToRemove);
      return {
        ...card,
        aiTags: aiTags && aiTags.length > 0 ? aiTags : undefined,
        updatedAt: now,
      };
    }
    case "addColor":
    case "removeColor":
      return typeof value === "string"
        ? {
            ...card,
            colors: editPaletteColors(card.colors, field, value),
            updatedAt: now,
          }
        : null;
    default:
      if (!TEXT_FIELDS.has(field)) {
        return null;
      }
      return {
        ...card,
        [field]: typeof value === "string" ? value.trim() || undefined : value,
        ...(field === "metadataTitle" ? { metadataTitleEdited: true } : {}),
        updatedAt: now,
      };
  }
}

/**
 * The edits `bulkUpdateCards` makes to one card, as the server's
 * `applyCardAction` makes them, for any action but a folder one.
 */
export function bulkActionEdits(
  card: Doc<"cards">,
  action: Exclude<BulkCardAction, FolderAction>,
  tags: readonly string[] = []
): CardFieldEdit[] {
  switch (action) {
    case "favorite":
    case "unfavorite": {
      const isFavorited = action === "favorite";
      return Boolean(card.isFavorited) === isFavorited
        ? []
        : [{ field: "isFavorited", value: isFavorited }];
    }
    case "archive":
    case "unarchive":
    case "delete":
    case "restore":
      return [{ field: action }];
    case "addTags": {
      const next = tagsWithAdded(card.tags, tags);
      return next.length === (card.tags ?? []).length
        ? []
        : [{ field: "tags", value: next }];
    }
    case "removeTags": {
      const kept = tagsWithout(card.tags, tags);
      const edits: CardFieldEdit[] =
        kept.length === (card.tags ?? []).length
          ? []
          : [{ field: "tags", value: kept }];
      for (const aiTag of card.aiTags ?? []) {
        if (findTag(tags, aiTag)) {
          edits.push({ field: "removeAiTag", tagToRemove: aiTag });
        }
      }
      return edits;
    }
    default:
      return [];
  }
}

/** The card in exactly these folders. */
export function cardWithFolderIds(
  card: Doc<"cards">,
  folderIds: readonly string[],
  now: number
): Doc<"cards"> {
  const current = (card.folderIds ?? []) as string[];
  if (
    folderIds.length === current.length &&
    folderIds.every((id, index) => id === current[index])
  ) {
    return card;
  }
  return {
    ...card,
    folderIds: (folderIds.length > 0
      ? [...folderIds]
      : undefined) as Doc<"cards">["folderIds"],
    updatedAt: now,
  };
}

const folderIdsAfter = (
  current: readonly string[],
  action: FolderAction,
  folder: { folderId: string; fromFolderId?: string }
): string[] => {
  if (action === "removeFromFolder") {
    return current.filter((id) => id !== folder.folderId);
  }
  let kept = [...current];
  if (action === "moveToFolder") {
    kept = folder.fromFolderId
      ? current.filter((id) => id !== folder.fromFolderId)
      : [];
  }
  return kept.includes(folder.folderId) ? kept : [...kept, folder.folderId];
};

/** The card as `bulkUpdateCards` will leave it. */
export function applyBulkActionToCard(
  card: Doc<"cards">,
  action: BulkCardAction,
  tags: readonly string[] = [],
  now = Date.now(),
  folder?: { folderId: string; fromFolderId?: string }
): Doc<"cards"> {
  if (
    action === "addToFolder" ||
    action === "removeFromFolder" ||
    action === "moveToFolder"
  ) {
    return folder
      ? cardWithFolderIds(
          card,
          folderIdsAfter((card.folderIds ?? []) as string[], action, folder),
          now
        )
      : card;
  }
  return bulkActionEdits(card, action, tags).reduce(
    (current, edit) => cardAfterFieldUpdate(current, edit, now) ?? current,
    card
  );
}

/**
 * Applies an `updateCardField` edit to every cached copy of the card. It only
 * writes to the local store, so Convex can replay it.
 */
export function applyCardFieldUpdate(
  localStore: OptimisticLocalStore,
  args: UpdateCardFieldArgs,
  now = Date.now()
) {
  updateCardsInSearchQueries(
    localStore,
    new Set([args.cardId]),
    (card) => cardAfterFieldUpdate(card, args, now) ?? card
  );
}

/** Applies a `bulkUpdateCards` call to every cached copy of its cards. */
export function applyBulkUpdate(
  localStore: OptimisticLocalStore,
  { action, cardIds, folderId, fromFolderId, tags }: BulkUpdateCardsArgs,
  now = Date.now()
) {
  updateCardsInSearchQueries(localStore, new Set(cardIds), (card) =>
    applyBulkActionToCard(
      card,
      action,
      tags,
      now,
      folderId ? { folderId, fromFolderId } : undefined
    )
  );
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
