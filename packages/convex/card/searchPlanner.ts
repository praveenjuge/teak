import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import {
  combineSearchQueries,
  matchesDoneState,
  matchesImageText,
  matchesPriceBounds,
  matchesSearchPhrases,
  type ParsedSearchQuery,
  type PriceBound,
} from "../shared/search/qualifiers";
import { isCardHidden } from "../shared/tags";
import { cardSiteHost } from "../shared/utils/urlHost";
import { revealsHidden } from "./hiddenCards";
import type { ArchivedFilter } from "./listQuery";
import {
  buildCardSearchText,
  normalizeCardSearchTag,
} from "./searchDocumentHelpers";

export interface SearchViewFilters {
  archived: ArchivedFilter;
  favoritesOnly?: boolean;
  folderId?: Id<"folders">;
  tag?: string;
  trash?: boolean;
  types?: readonly CardType[];
}

export interface ResolvedSearch {
  archived: ArchivedFilter;
  favoritesOnly: boolean;
  folderIds: Id<"folders">[];
  hasCardFilters: boolean;
  includeHidden: boolean;
  matches: (card: Doc<"cards">, searchableText?: string) => boolean;
  /**
   * `matches` decided from a card's search document, when every check reads
   * a field the document keeps in step with the card; otherwise undefined.
   */
  matchesDocument?: (document: Doc<"cardSearchDocuments">) => boolean;
  ocrText: string;
  phrases: string[];
  prices: PriceBound[];
  similarity: ParsedSearchQuery["similarity"];
  sites: string[];
  tags: string[];
  text: string;
  trash: boolean;
  types?: CardType[];
}

const cardHasTag = (card: Doc<"cards">, tag: string) =>
  [...(card.tags ?? []), ...(card.aiTags ?? [])].some(
    (cardTag) => normalizeCardSearchTag(cardTag) === tag
  );

/** The site a card is on, read from its URL so unsynced cards match too. */
export const cardUrlHost = (
  card: Pick<Doc<"cards">, "sourceUrl" | "url" | "urlHost">
) => cardSiteHost(card) ?? card.urlHost ?? null;

export const resolveFolderNames = async (
  ctx: QueryCtx,
  userId: string,
  nameKeys: readonly string[]
): Promise<Id<"folders">[] | null> => {
  const folderIds: Id<"folders">[] = [];
  for (const nameKey of nameKeys) {
    let found: Id<"folders"> | undefined;
    for await (const folder of ctx.db
      .query("folders")
      .withIndex("by_userId_and_nameKey", (query) =>
        query.eq("userId", userId).eq("nameKey", nameKey)
      )) {
      if (folder.deletingAt === undefined) {
        found = folder.kind === "smart" ? undefined : folder._id;
        break;
      }
    }
    if (!found) {
      return null;
    }
    folderIds.push(found);
  }
  return folderIds;
};

export const expandFolderSearch = async (
  ctx: QueryCtx,
  userId: string,
  folderId: Id<"folders"> | undefined,
  searchQuery: string,
  folderQuery?: string
): Promise<{ folderId?: Id<"folders">; searchQuery: string } | null> => {
  if (!folderId) {
    return { searchQuery };
  }
  const folder = await ctx.db.get("folders", folderId);
  if (!folder || folder.userId !== userId || folder.deletingAt !== undefined) {
    return null;
  }
  if (folder.kind !== "smart") {
    return { folderId, searchQuery };
  }
  const combined = combineSearchQueries(
    folderQuery ?? folder.query ?? "",
    searchQuery
  );
  return combined === null ? null : { searchQuery: combined };
};

/**
 * The card types a parsed query can match within `types` (undefined for any
 * type): `type:` qualifiers intersect them, `is:done`, `is:todo` and prices
 * only match links, and a mood search only matches images. Null when the
 * query can match no type.
 */
export const narrowTypesForQuery = (
  parsed: Pick<
    ParsedSearchQuery,
    "done" | "prices" | "similarity" | "todo" | "types"
  >,
  types: readonly CardType[] | undefined
): CardType[] | null | undefined => {
  let narrowed = types?.length ? [...types] : undefined;
  if (parsed.types.length > 0) {
    narrowed = narrowed
      ? narrowed.filter((type) => parsed.types.includes(type))
      : [...parsed.types];
    if (narrowed.length === 0) {
      return null;
    }
  }
  if (parsed.done && parsed.todo) {
    return null;
  }
  if (parsed.prices.length > 0 || parsed.done || parsed.todo) {
    if (narrowed && !narrowed.includes("link")) {
      return null;
    }
    narrowed = ["link"];
  }
  if (parsed.similarity?.kind === "mood") {
    narrowed = narrowed
      ? narrowed.filter((type) => type === "image")
      : ["image"];
    if (narrowed.length === 0) {
      return null;
    }
  }
  return narrowed;
};

export const resolveSearch = async (
  ctx: QueryCtx,
  userId: string,
  parsed: ParsedSearchQuery,
  view: SearchViewFilters
): Promise<ResolvedSearch | null> => {
  const trash = view.trash === true;

  const types = narrowTypesForQuery(parsed, view.types);
  if (types === null) {
    return null;
  }

  const archivedInTrash = trash && parsed.archived;
  const archived: ArchivedFilter =
    !trash && parsed.archived ? "only" : view.archived;

  const folderIds: Id<"folders">[] = [];
  if (view.folderId) {
    const folder = await ctx.db.get("folders", view.folderId);
    if (
      !folder ||
      folder.userId !== userId ||
      folder.deletingAt !== undefined
    ) {
      return null;
    }
    folderIds.push(folder._id);
  }
  const named = await resolveFolderNames(ctx, userId, parsed.folders);
  if (!named) {
    return null;
  }
  for (const folderId of named) {
    if (!folderIds.includes(folderId)) {
      folderIds.push(folderId);
    }
  }

  const tags = Array.from(
    new Set([view.tag ?? "", ...parsed.tags].map(normalizeCardSearchTag))
  ).filter(Boolean);
  const { sites, phrases, prices, ocrTexts } = parsed;
  const includeHidden = revealsHidden(tags);

  const matches = (card: Doc<"cards">, searchableText?: string) => {
    if (card.userId !== userId) {
      return false;
    }
    if (!includeHidden && isCardHidden(card)) {
      return false;
    }
    if (archivedInTrash && card.isArchived !== true) {
      return false;
    }
    if (types && !types.includes(card.type)) {
      return false;
    }
    if ((view.favoritesOnly || parsed.favorite) && card.isFavorited !== true) {
      return false;
    }
    const cardFolders = card.folderIds ?? [];
    if (!folderIds.every((folderId) => cardFolders.includes(folderId))) {
      return false;
    }
    if (!tags.every((tag) => cardHasTag(card, tag))) {
      return false;
    }
    if (sites.length > 0) {
      const host = cardUrlHost(card);
      if (!(host && sites.includes(host))) {
        return false;
      }
    }
    if (
      !matchesPriceBounds(card.metadata?.linkCategory?.price?.amount, prices)
    ) {
      return false;
    }
    if (!matchesImageText(card.aiOcrText, ocrTexts)) {
      return false;
    }
    if (!matchesDoneState(card, parsed)) {
      return false;
    }
    return matchesSearchPhrases(
      searchableText ?? buildCardSearchText(card),
      phrases
    );
  };
  const favoritesOnly = Boolean(view.favoritesOnly || parsed.favorite);
  const readsOnlyDocumentFields =
    folderIds.length === 0 &&
    tags.length === 0 &&
    prices.length === 0 &&
    ocrTexts.length === 0 &&
    !parsed.done &&
    !parsed.todo;
  const matchesDocument = (document: Doc<"cardSearchDocuments">) =>
    document.userId === userId &&
    (includeHidden || document.isHidden !== true) &&
    (!archivedInTrash || document.isArchived === true) &&
    (!types || types.includes(document.type)) &&
    (!favoritesOnly || document.isFavorited === true) &&
    (sites.length === 0 ||
      (document.urlHost !== undefined && sites.includes(document.urlHost))) &&
    matchesSearchPhrases(document.searchableText, phrases);

  return {
    archived,
    favoritesOnly,
    folderIds,
    hasCardFilters:
      archivedInTrash ||
      folderIds.length > 1 ||
      tags.length > 1 ||
      sites.length > 0 ||
      phrases.length > 0 ||
      prices.length > 0 ||
      ocrTexts.length > 0 ||
      parsed.done ||
      parsed.todo,
    includeHidden,
    matches,
    matchesDocument: readsOnlyDocumentFields ? matchesDocument : undefined,
    ocrText: ocrTexts.join(" "),
    phrases,
    similarity: parsed.similarity ?? null,
    prices,
    sites,
    tags,
    text: parsed.text,
    trash,
    types,
  };
};
