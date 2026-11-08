import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { SEARCH_PREFIX_MAX_BYTES } from "../card/documentTextFormat";
import { revealsHidden } from "../card/hiddenCards";
import type { ArchivedFilter, CardListScope } from "../card/listQuery";
import type { CardType } from "../shared/constants";
import type { SearchQuickCommand } from "../shared/search/constants";
import {
  expressionFolderNames,
  expressionHasWords,
  expressionRevealTags,
  expressionWantsArchived,
  matchesExpression,
} from "../shared/search/expression";
import {
  combineSearchQueries,
  matchesDoneState,
  matchesImageText,
  matchesPriceBounds,
  matchesSearchPhrases,
  type ParsedSearchQuery,
  type PriceBound,
  type SearchExpression,
} from "../shared/search/qualifiers";
import { buildCardSearchText } from "../shared/search/searchText";
import { tokenizeSearchInput } from "../shared/search/tokenization";
import { isCardHidden, tagKey } from "../shared/tags";
import { cardUrlHost } from "../shared/utils/urlHost";

export interface QuickCommandList {
  favoritesOnly: boolean | undefined;
  list: { favoritesOnly?: true; scope?: CardListScope };
}

/**
 * The list a bare quick command (`favorites`, `trash`, `archive`) opens in
 * place of a text search, and whether its cards must be favourites.
 */
export const quickCommandList = (
  command: NonNullable<SearchQuickCommand>,
  favoritesOnly: boolean | undefined
): QuickCommandList =>
  command === "favorites"
    ? { list: { favoritesOnly: true }, favoritesOnly: true }
    : { list: { scope: command }, favoritesOnly };

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
  matchesDocument?: (document: Doc<"cardSearchDocuments">) => boolean;
  /**
   * Whether text holds every word and phrase the query types, as the web
   * client checks them. The search index finds a card with any one word, so
   * a keyword match can hold only some of them.
   */
  matchesWords: (searchableText: string) => boolean;
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

const EXPRESSION_TEXT_READ_BUDGET_CHARS = 2 * 1024 * 1024;

/**
 * Reads the search document's text for a card when an expression checks
 * words and the card's own fields leave some of its text out (a document's
 * text, a long transcript). Returns undefined for other cards, and once the
 * search's budget is spent, so the caller falls back to the card's fields.
 */
export const expressionTextReader = (
  ctx: Pick<QueryCtx, "db">,
  expression: SearchExpression | undefined
) => {
  const readsWords = expressionHasWords(expression);
  let remaining = EXPRESSION_TEXT_READ_BUDGET_CHARS;
  return async (card: Doc<"cards">): Promise<string | undefined> => {
    // What the document holds beyond the card: up to 32 KB of a file's
    // text, and a transcript that moved off the card. It is reserved before
    // the read, so reads that run together share the budget.
    const movedTranscript =
      card.aiTranscript === undefined ? (card.aiTranscriptCharCount ?? 0) : 0;
    const fileText =
      card.hasExtractedText === true
        ? Math.min(
            SEARCH_PREFIX_MAX_BYTES,
            card.extractedTextCharCount ?? SEARCH_PREFIX_MAX_BYTES
          )
        : 0;
    const chars = fileText + movedTranscript;
    if (!readsWords || chars === 0 || chars > remaining) {
      return undefined;
    }
    remaining -= chars;
    const document = await ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (q) => q.eq("cardId", card._id))
      .unique();
    return document?.searchableText;
  };
};

/** Whether a card has a tag, by its key (`tagKey`). */
export const cardHasTag = (card: Doc<"cards">, key: string) =>
  [...(card.tags ?? []), ...(card.aiTags ?? [])].some(
    (cardTag) => tagKey(cardTag) === key
  );

/**
 * What a search asks of each card once the folders and tags it names are
 * resolved. App search (`resolveSearch`) and the public API both check cards
 * with `matchesCardSearch`, so a qualifier means the same everywhere.
 */
export interface CardSearchFilter {
  /** `is:archived` while listing Trash: archived cards only. */
  archivedInTrash: boolean;
  done: boolean;
  expression?: SearchExpression;
  /** The folders `expression` names, by name key; null for none. */
  expressionFolders?: ReadonlyMap<string, Id<"folders"> | null>;
  favoritesOnly: boolean;
  /** Folders a card must be in, every one of them. */
  folderIds: readonly Id<"folders">[];
  ocrTexts: readonly string[];
  phrases: readonly string[];
  pinned: boolean;
  prices: readonly PriceBound[];
  /** The search's own tags name a hidden tag, so hidden cards show. */
  revealedByTags: boolean;
  /** Hidden tags an OR branch names: a hidden card shows when it has one. */
  revealTags: readonly string[];
  sites: readonly string[];
  /** Tag keys a card must have, every one of them. */
  tags: readonly string[];
  todo: boolean;
  types?: readonly CardType[];
}

/**
 * Whether a card matches a search's filters and qualifiers. Pass the card's
 * search document text when the card's own fields leave some of it out;
 * otherwise words are matched against the card's fields.
 */
export const matchesCardSearch = (
  card: Doc<"cards">,
  filter: CardSearchFilter,
  searchableText?: string
): boolean => {
  const hidden = isCardHidden(card);
  if (
    hidden &&
    !(
      filter.revealedByTags ||
      filter.revealTags.some((revealTag) => cardHasTag(card, revealTag))
    )
  ) {
    return false;
  }
  if (filter.archivedInTrash && card.isArchived !== true) {
    return false;
  }
  if (filter.types && !filter.types.includes(card.type)) {
    return false;
  }
  if (filter.favoritesOnly && card.isFavorited !== true) {
    return false;
  }
  const cardFolders = card.folderIds ?? [];
  if (!filter.folderIds.every((folderId) => cardFolders.includes(folderId))) {
    return false;
  }
  if (!filter.tags.every((tag) => cardHasTag(card, tag))) {
    return false;
  }
  if (filter.sites.length > 0) {
    const host = cardUrlHost(card);
    if (!(host && filter.sites.includes(host))) {
      return false;
    }
  }
  if (
    !matchesPriceBounds(
      card.metadata?.linkCategory?.price?.amount,
      filter.prices
    )
  ) {
    return false;
  }
  if (!matchesImageText(card.aiOcrText, filter.ocrTexts)) {
    return false;
  }
  if (!matchesDoneState(card, filter)) {
    return false;
  }
  if (filter.pinned && card.pinPosition === undefined) {
    return false;
  }
  const { expression } = filter;
  if (!(expression || filter.phrases.length > 0)) {
    return true;
  }
  const text = searchableText ?? buildCardSearchText(card);
  if (!matchesSearchPhrases(text, filter.phrases)) {
    return false;
  }
  return (
    !expression ||
    matchesExpression(
      expression,
      card,
      text,
      {
        folder: (name) => {
          const folderId = filter.expressionFolders?.get(name);
          return Boolean(folderId && cardFolders.includes(folderId));
        },
        hasTag: (tag) => cardHasTag(card, tagKey(tag)),
        host: cardUrlHost(card),
      },
      hidden && !filter.revealedByTags
    )
  );
};

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

/**
 * The folders an expression names, by name key. A name that matches no
 * manual folder maps to null, so its filter matches nothing without
 * emptying the whole search.
 */
export const resolveExpressionFolders = async (
  ctx: QueryCtx,
  userId: string,
  expression: SearchExpression | undefined
): Promise<Map<string, Id<"folders"> | null>> => {
  const folders = new Map<string, Id<"folders"> | null>();
  for (const name of expressionFolderNames(expression)) {
    folders.set(
      name,
      (await resolveFolderNames(ctx, userId, [name]))?.[0] ?? null
    );
  }
  return folders;
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

  const { expression } = parsed;
  const archivedInTrash = trash && parsed.archived;
  let archived: ArchivedFilter =
    !trash && parsed.archived ? "only" : view.archived;
  if (archived === "exclude" && expressionWantsArchived(expression)) {
    archived = "include";
  }

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

  const expressionFolders = await resolveExpressionFolders(
    ctx,
    userId,
    expression
  );

  const tags = Array.from(
    new Set([view.tag ?? "", ...parsed.tags].map(tagKey))
  ).filter(Boolean);
  const { sites, phrases, prices, ocrTexts } = parsed;
  const revealedByTags = revealsHidden(tags);
  const revealTags = revealedByTags ? [] : expressionRevealTags(expression);
  const includeHidden = revealedByTags || revealTags.length > 0;

  const filter: CardSearchFilter = {
    archivedInTrash,
    done: parsed.done,
    expression,
    expressionFolders,
    favoritesOnly: Boolean(view.favoritesOnly || parsed.favorite),
    folderIds,
    ocrTexts,
    phrases,
    pinned: parsed.pinned,
    prices,
    revealedByTags,
    revealTags,
    sites,
    tags,
    todo: parsed.todo,
    types,
  };
  const matches = (card: Doc<"cards">, searchableText?: string) =>
    card.userId === userId && matchesCardSearch(card, filter, searchableText);
  const { favoritesOnly } = filter;
  const readsOnlyDocumentFields =
    !expression &&
    revealTags.length === 0 &&
    folderIds.length === 0 &&
    tags.length === 0 &&
    prices.length === 0 &&
    ocrTexts.length === 0 &&
    !parsed.done &&
    !parsed.todo &&
    !parsed.pinned;
  const matchesDocument = (document: Doc<"cardSearchDocuments">) =>
    document.userId === userId &&
    (includeHidden || document.isHidden !== true) &&
    (!archivedInTrash || document.isArchived === true) &&
    (!types || types.includes(document.type)) &&
    (!favoritesOnly || document.isFavorited === true) &&
    (sites.length === 0 ||
      (document.urlHost !== undefined && sites.includes(document.urlHost))) &&
    matchesSearchPhrases(document.searchableText, phrases);

  const words = tokenizeSearchInput(parsed.terms.join(" ")).map((word) =>
    word.toLowerCase()
  );
  const matchesWords = (searchableText: string) => {
    const text = searchableText.toLowerCase();
    return (
      words.every((word) => text.includes(word)) &&
      matchesSearchPhrases(text, phrases)
    );
  };

  return {
    archived,
    favoritesOnly,
    folderIds,
    hasCardFilters:
      expression !== undefined ||
      archivedInTrash ||
      folderIds.length > 1 ||
      tags.length > 1 ||
      sites.length > 0 ||
      phrases.length > 0 ||
      prices.length > 0 ||
      ocrTexts.length > 0 ||
      parsed.done ||
      parsed.todo ||
      parsed.pinned,
    includeHidden,
    matches,
    matchesDocument: readsOnlyDocumentFields ? matchesDocument : undefined,
    matchesWords,
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
