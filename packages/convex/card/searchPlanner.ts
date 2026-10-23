import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
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
import { isCardHidden } from "../shared/tags";
import { cardSiteHost } from "../shared/utils/urlHost";
import { SEARCH_PREFIX_MAX_BYTES } from "./documentTextFormat";
import { revealsHidden } from "./hiddenCards";
import type { ArchivedFilter } from "./listQuery";
import { buildCardSearchText, normalizeCardSearchTag } from "./searchSync";

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

// Search document text one search may read back for an expression's words.
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
    const chars =
      (card.hasExtractedText === true ? SEARCH_PREFIX_MAX_BYTES : 0) +
      movedTranscript;
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

export const cardHasTag = (card: Doc<"cards">, tag: string) =>
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

  const { expression } = parsed;
  const archivedInTrash = trash && parsed.archived;
  let archived: ArchivedFilter =
    !trash && parsed.archived ? "only" : view.archived;
  // `is:archived` inside an OR or group reads archived cards too, and the
  // expression decides which of them match.
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
    new Set([view.tag ?? "", ...parsed.tags].map(normalizeCardSearchTag))
  ).filter(Boolean);
  const { sites, phrases, prices, ocrTexts } = parsed;
  const revealedByTags = revealsHidden(tags);
  // Hidden cards come only through an OR branch that asks for their tag.
  const revealTags = revealedByTags ? [] : expressionRevealTags(expression);
  const includeHidden = revealedByTags || revealTags.length > 0;

  const matches = (card: Doc<"cards">, searchableText?: string) => {
    if (card.userId !== userId) {
      return false;
    }
    if (
      isCardHidden(card) &&
      !(
        revealedByTags ||
        revealTags.some((revealTag) => cardHasTag(card, revealTag))
      )
    ) {
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
    const text = searchableText ?? buildCardSearchText(card);
    if (!matchesSearchPhrases(text, phrases)) {
      return false;
    }
    return (
      !expression ||
      matchesExpression(expression, card, text, {
        folder: (name) => {
          const folderId = expressionFolders.get(name);
          return Boolean(folderId && cardFolders.includes(folderId));
        },
        hasTag: (tag) => cardHasTag(card, normalizeCardSearchTag(tag)),
        host: cardUrlHost(card),
      })
    );
  };
  const favoritesOnly = Boolean(view.favoritesOnly || parsed.favorite);
  const readsOnlyDocumentFields =
    !expression &&
    revealTags.length === 0 &&
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
      expression !== undefined ||
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
