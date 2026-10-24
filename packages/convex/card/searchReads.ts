import type { IndexRange, SearchFilterFinalizer } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { savedAtOf } from "../shared/search/sort";
import { isCardHidden, isHiddenTagList } from "../shared/tags";
import { cardSiteHost } from "../shared/utils/urlHost";
import { SEARCH_PREFIX_MAX_BYTES } from "./documentTextFormat";
import {
  type ArchivedFilter,
  cardListScope,
  scopeArchivedMatch,
} from "./listQuery";
import { scanInBatches } from "./scanInBatches";
import { buildCardSearchText, normalizeCardSearchTag } from "./searchSync";
import { readCardTranscript } from "./textContents";

interface SavedAtRange {
  gte: (
    field: "cardSavedAt",
    value: number
  ) => { lte: (field: "cardSavedAt", value: number) => IndexRange };
}

export const searchCardsByExactTag = async (
  ctx: QueryCtx,
  args: {
    userId: string;
    tag: string;
    isDeleted?: boolean;
    isFavorited?: boolean;
    archived?: ArchivedFilter;
    type?: Doc<"cards">["type"];
    // The API's names; they bound the card's saved date (`cardSavedAt`).
    createdAfter?: number;
    createdBefore?: number;
    limit: number;
    scanBudget?: { remaining: number; hitSearchLimit?: boolean };
    sort: "newest" | "oldest";
    resultFilter?: (card: Doc<"cards">) => boolean | Promise<boolean>;
    includeHidden?: boolean;
  }
): Promise<Doc<"cards">[]> => {
  const tag = normalizeCardSearchTag(args.tag);
  if (!tag) {
    return [];
  }
  const includeHidden = args.includeHidden || isHiddenTagList([tag]);
  const { isFavorited, type } = args;
  const favorited = isFavorited === true ? true : undefined;
  const archived = scopeArchivedMatch(
    cardListScope(args.archived, args.isDeleted === true)
  );
  const matchLimit = Math.min(4096, Math.max(1, args.limit));
  const order = args.sort === "oldest" ? "asc" : "desc";
  const savedBetween = (range: SavedAtRange) =>
    range
      .gte("cardSavedAt", args.createdAfter ?? Number.MIN_SAFE_INTEGER)
      .lte("cardSavedAt", args.createdBefore ?? Number.MAX_SAFE_INTEGER);
  const tags = ctx.db.query("cardSearchTags");
  let tagQuery: AsyncIterable<Doc<"cardSearchTags">>;
  if (archived === "any") {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_saved", (range) =>
        savedBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
        )
      )
      .order(order);
  } else if (type !== undefined && isFavorited !== undefined) {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_archived_type_favorited_saved", (range) =>
        savedBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
            .eq("isArchived", archived)
            .eq("type", type)
            .eq("isFavorited", favorited)
        )
      )
      .order(order);
  } else if (type !== undefined) {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_archived_type_saved", (range) =>
        savedBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
            .eq("isArchived", archived)
            .eq("type", type)
        )
      )
      .order(order);
  } else if (isFavorited === undefined) {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_archived_saved", (range) =>
        savedBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
            .eq("isArchived", archived)
        )
      )
      .order(order);
  } else {
    tagQuery = tags
      .withIndex("by_user_tag_deleted_archived_favorited_saved", (range) =>
        savedBetween(
          range
            .eq("userId", args.userId)
            .eq("tag", tag)
            .eq("isDeleted", args.isDeleted)
            .eq("isArchived", archived)
            .eq("isFavorited", favorited)
        )
      )
      .order(order);
  }
  const cardsById = new Map<Id<"cards">, Doc<"cards">>();
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  for await (const document of tagQuery) {
    if (scanBudget.remaining <= 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Search is too broad. Add a type or date filter.",
      });
    }
    scanBudget.remaining -= 1;
    if (
      archived === "any" &&
      ((type !== undefined && document.type !== type) ||
        (isFavorited !== undefined &&
          (document.isFavorited === true) !== isFavorited))
    ) {
      continue;
    }
    const card = await ctx.db.get("cards", document.cardId);
    if (
      card &&
      (includeHidden || !isCardHidden(card)) &&
      (!args.resultFilter || (await args.resultFilter(card)))
    ) {
      cardsById.set(card._id, card);
      if (cardsById.size >= matchLimit) {
        break;
      }
    }
  }
  return Array.from(cardsById.values());
};

interface DocumentSearchArgs {
  archived?: ArchivedFilter;
  includeHidden?: boolean;
  isDeleted?: boolean;
  isFavorited?: boolean;
  limit: number;
  resultFilter?: (card: Doc<"cards">, searchableText: string) => boolean;
  scanBudget?: {
    remaining: number;
    hitSearchLimit?: boolean;
    textRemaining?: number;
  };
  searchQuery: string;
  searchTexts?: Map<Id<"cards">, string>;
  type?: Doc<"cards">["type"];
  urlHost?: string;
  userId: string;
}

const searchTooBroad = () =>
  new ConvexError({
    code: "INVALID_INPUT",
    message: "Search is too broad. Add a type or date filter.",
  });

type SearchDocumentFilter = SearchFilterFinalizer<
  Doc<"cardSearchDocuments">,
  {
    searchField: string;
    filterFields:
      | "isArchived"
      | "isDeleted"
      | "isFavorited"
      | "isHidden"
      | "type"
      | "urlHost"
      | "userId";
  }
>;

const filterSearchIndex = (
  query: SearchDocumentFilter,
  args: DocumentSearchArgs,
  archived: true | undefined | "any"
) => {
  let filtered = query
    .eq("userId", args.userId)
    .eq("isDeleted", args.isDeleted);
  if (archived !== "any") {
    filtered = filtered.eq("isArchived", archived);
  }
  if (args.type !== undefined) {
    filtered = filtered.eq("type", args.type);
  }
  if (args.isFavorited !== undefined) {
    filtered = filtered.eq("isFavorited", args.isFavorited ? true : undefined);
  }
  if (args.urlHost !== undefined) {
    filtered = filtered.eq("urlHost", args.urlHost);
  }
  if (!args.includeHidden) {
    filtered = filtered.eq("isHidden", undefined);
  }
  return filtered;
};

const keepSearchDocuments = async (
  ctx: QueryCtx,
  args: DocumentSearchArgs,
  scanBudget: NonNullable<DocumentSearchArgs["scanBudget"]>,
  read: (sourceLimit: number) => Promise<Doc<"cardSearchDocuments">[]>
) => {
  const cardsById = new Map<Id<"cards">, Doc<"cards">>();
  const matchLimit = Math.min(1024, Math.max(1, args.limit));
  const sourceLimit = Math.min(1024, scanBudget.remaining);
  if (sourceLimit <= 0) {
    throw searchTooBroad();
  }
  const documents = await read(sourceLimit);
  scanBudget.remaining -= documents.length;
  if (documents.length === sourceLimit) {
    scanBudget.hitSearchLimit = true;
  }
  await scanInBatches(
    documents,
    () => matchLimit - cardsById.size,
    (document) => ctx.db.get("cards", document.cardId),
    (document, card) => {
      if (
        card &&
        (args.includeHidden || !isCardHidden(card)) &&
        (!args.resultFilter || args.resultFilter(card, document.searchableText))
      ) {
        cardsById.set(card._id, card);
        args.searchTexts?.set(card._id, document.searchableText);
      }
    }
  );
  // Convex checks its 1,024-result cap before probing exhaustion, so a
  // saturated search cannot prove that all post-filter matches were examined.
  if (documents.length === sourceLimit && cardsById.size < matchLimit) {
    throw searchTooBroad();
  }
  return { cardsById, matchLimit };
};

export const searchCardsByDocument = async (
  ctx: QueryCtx,
  args: DocumentSearchArgs
): Promise<Doc<"cards">[]> => {
  const archived = scopeArchivedMatch(
    cardListScope(args.archived, args.isDeleted === true)
  );
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  const found = await keepSearchDocuments(ctx, args, scanBudget, (limit) =>
    ctx.db
      .query("cardSearchDocuments")
      .withSearchIndex("search_searchableText", (query) =>
        filterSearchIndex(
          query.search("searchableText", args.searchQuery),
          args,
          archived
        )
      )
      .take(limit)
  );
  if (found.cardsById.size < found.matchLimit) {
    await addCardsFoundByFileText(ctx, args, archived, scanBudget, {
      has: (cardId) => found.cardsById.has(cardId),
      wanted: () => found.matchLimit - found.cardsById.size,
      add: (card, searchableText) => {
        found.cardsById.set(card._id, card);
        args.searchTexts?.set(card._id, searchableText);
      },
    });
  }
  return Array.from(found.cardsById.values());
};

/**
 * A card a text search matched, with the fields its order needs. `card` is
 * loaded when the match needed it; otherwise `document` holds the match.
 */
export interface SearchCandidate {
  card?: Doc<"cards">;
  cardId: Id<"cards">;
  creationTime: number;
  document?: Doc<"cardSearchDocuments">;
  /** The card's `savedAt ?? createdAt`, which orders the matches. */
  savedAt: number;
  searchableText: string;
}

export const searchCandidateOf = (
  card: Doc<"cards">,
  searchableText = ""
): SearchCandidate => ({
  card,
  cardId: card._id,
  creationTime: card._creationTime,
  savedAt: savedAtOf(card),
  searchableText,
});

/**
 * `searchCardsByDocument` without loading cards: `keepDocument` decides a
 * match from its search document and the card's dates stored there, so a
 * page loads only its own cards. A match found in file text loads the card
 * and goes through `resultFilter` as `searchCardsByDocument` would. With
 * neither filter every
 * match is kept, as `searchCardsByDocument` keeps every visible card.
 */
export const searchCandidatesByDocument = async (
  ctx: QueryCtx,
  args: Omit<DocumentSearchArgs, "searchTexts"> & {
    keepDocument?: (
      document: Doc<"cardSearchDocuments">,
      savedAt: number
    ) => boolean;
  }
): Promise<SearchCandidate[]> => {
  const archived = scopeArchivedMatch(
    cardListScope(args.archived, args.isDeleted === true)
  );
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  const matchLimit = Math.min(1024, Math.max(1, args.limit));
  const sourceLimit = Math.min(1024, scanBudget.remaining);
  if (sourceLimit <= 0) {
    throw searchTooBroad();
  }
  const documents = await ctx.db
    .query("cardSearchDocuments")
    .withSearchIndex("search_searchableText", (query) =>
      filterSearchIndex(
        query.search("searchableText", args.searchQuery),
        args,
        archived
      )
    )
    .take(sourceLimit);
  scanBudget.remaining -= documents.length;
  if (documents.length === sourceLimit) {
    scanBudget.hitSearchLimit = true;
  }
  const found = new Map<Id<"cards">, SearchCandidate>();
  for (const document of documents) {
    if (found.size >= matchLimit) {
      break;
    }
    const savedAt = document.cardSavedAt ?? document.cardCreatedAt;
    if (!args.keepDocument || args.keepDocument(document, savedAt)) {
      found.set(document.cardId, {
        cardId: document.cardId,
        creationTime: document.cardCreationTime,
        document,
        savedAt,
        searchableText: document.searchableText,
      });
    }
  }
  if (documents.length === sourceLimit && found.size < matchLimit) {
    throw searchTooBroad();
  }
  if (found.size < matchLimit) {
    await addCardsFoundByFileText(ctx, args, archived, scanBudget, {
      has: (cardId) => found.has(cardId),
      wanted: () => matchLimit - found.size,
      add: (card, searchableText) =>
        found.set(card._id, searchCandidateOf(card, searchableText)),
    });
  }
  return Array.from(found.values());
};

export const searchCardsByOcrText = async (
  ctx: QueryCtx,
  args: Omit<DocumentSearchArgs, "scanBudget"> & {
    scanBudget?: { remaining: number; hitSearchLimit?: boolean };
  }
): Promise<Doc<"cards">[]> => {
  const archived = scopeArchivedMatch(
    cardListScope(args.archived, args.isDeleted === true)
  );
  const scanBudget = args.scanBudget ?? { remaining: 4096 };
  const found = await keepSearchDocuments(ctx, args, scanBudget, (limit) =>
    ctx.db
      .query("cardSearchDocuments")
      .withSearchIndex("search_ocrText", (query) =>
        filterSearchIndex(
          query.search("ocrText", args.searchQuery),
          args,
          archived
        )
      )
      .take(limit)
  );
  return Array.from(found.cardsById.values());
};

// Transcript text one search may read back to match a card's own text.
const TRANSCRIPT_SEARCH_READ_BUDGET_CHARS = 2 * 1024 * 1024;

/**
 * Reads the search text of cards whose transcript moved to
 * `cardTextContents`, which `buildCardSearchText(card)` alone misses. Returns
 * undefined for other cards, and once the search's budget is spent, so the
 * caller falls back to the card's own fields.
 */
export const movedTranscriptSearchText = (ctx: Pick<QueryCtx, "db">) => {
  let remaining = TRANSCRIPT_SEARCH_READ_BUDGET_CHARS;
  return async (card: Doc<"cards">): Promise<string | undefined> => {
    const chars = card.aiTranscriptCharCount;
    if (chars === undefined || chars > remaining) {
      return undefined;
    }
    remaining -= chars;
    return buildCardSearchText(
      card,
      undefined,
      await readCardTranscript(ctx, card)
    );
  };
};

export const loadSemanticMatches = async (
  ctx: QueryCtx,
  args: Pick<
    Parameters<typeof searchCardsByDocument>[1],
    | "userId"
    | "isDeleted"
    | "isFavorited"
    | "archived"
    | "type"
    | "urlHost"
    | "includeHidden"
  >,
  ranking: readonly { cardId: Id<"cards">; score: number }[],
  cardsById: Pick<Map<Id<"cards">, Doc<"cards">>, "has" | "set">,
  options: {
    minScore: number;
    keep: (card: Doc<"cards">, searchableText?: string) => boolean;
    /** Read moved transcripts back, for a `keep` that matches text. */
    withText?: boolean;
    /** Reads a card's full search text first, for words in an expression. */
    readText?: (card: Doc<"cards">) => Promise<string | undefined>;
  }
): Promise<{ cardId: Id<"cards">; score: number }[]> => {
  const archived = scopeArchivedMatch(
    cardListScope(args.archived, args.isDeleted === true)
  );
  const loaded = await Promise.all(
    ranking.map(async (match) => {
      if (cardsById.has(match.cardId) || match.score < options.minScore) {
        return null;
      }
      const card = await ctx.db.get("cards", match.cardId);
      return card &&
        card.userId === args.userId &&
        matchesSearchIndexFilters(card, args, archived)
        ? card
        : null;
    })
  );
  const readTranscript = movedTranscriptSearchText(ctx);
  const readText = async (card: Doc<"cards">) =>
    (await options.readText?.(card)) ??
    (options.withText ? await readTranscript(card) : undefined);
  const texts = await Promise.all(loaded.map((card) => card && readText(card)));
  const kept: { cardId: Id<"cards">; score: number }[] = [];
  for (const [index, match] of ranking.entries()) {
    if (cardsById.has(match.cardId)) {
      kept.push(match);
      continue;
    }
    const card = loaded[index];
    if (card && options.keep(card, texts[index] ?? undefined)) {
      cardsById.set(card._id, card);
      kept.push(match);
    }
  }
  return kept;
};

const FILE_TEXT_SEARCH_READ_BUDGET_BYTES = 4 * 1024 * 1024;
export const FILE_TEXT_SEARCH_LIMIT =
  FILE_TEXT_SEARCH_READ_BUDGET_BYTES / SEARCH_PREFIX_MAX_BYTES;

const addCardsFoundByFileText = async (
  ctx: QueryCtx,
  args: Pick<
    DocumentSearchArgs,
    | "includeHidden"
    | "isDeleted"
    | "isFavorited"
    | "resultFilter"
    | "searchQuery"
    | "type"
    | "urlHost"
    | "userId"
  >,
  archived: true | undefined | "any",
  scanBudget: { textRemaining?: number },
  found: {
    add: (card: Doc<"cards">, searchableText: string) => void;
    has: (cardId: Id<"cards">) => boolean;
    wanted: () => number;
  }
) => {
  if (args.type !== undefined && args.type !== "document") {
    return;
  }
  const textLimit = scanBudget.textRemaining ?? FILE_TEXT_SEARCH_LIMIT;
  if (textLimit <= 0) {
    return;
  }
  const rows = await ctx.db
    .query("cardTextContents")
    .withSearchIndex("search_text", (query) =>
      query.search("text", args.searchQuery).eq("userId", args.userId)
    )
    .take(textLimit);
  scanBudget.textRemaining = textLimit - rows.length;
  await scanInBatches(
    rows.filter((row) => !found.has(row.cardId)),
    found.wanted,
    (row) => ctx.db.get("cards", row.cardId),
    (row, card) => {
      if (!card || card.userId !== args.userId || found.has(card._id)) {
        return;
      }
      const searchableText = buildCardSearchText(card, row.text);
      if (
        matchesSearchIndexFilters(card, args, archived) &&
        (!args.resultFilter || args.resultFilter(card, searchableText))
      ) {
        found.add(card, searchableText);
      }
    }
  );
};

const matchesSearchIndexFilters = (
  card: Doc<"cards">,
  args: Pick<
    Parameters<typeof searchCardsByDocument>[1],
    "isDeleted" | "isFavorited" | "type" | "urlHost" | "includeHidden"
  >,
  archived: true | undefined | "any"
): boolean =>
  (args.includeHidden || !isCardHidden(card)) &&
  card.isDeleted === args.isDeleted &&
  (archived === "any" ||
    (card.isArchived === true ? true : undefined) === archived) &&
  (args.type === undefined || card.type === args.type) &&
  (args.isFavorited === undefined ||
    card.isFavorited === (args.isFavorited ? true : undefined)) &&
  (args.urlHost === undefined ||
    (cardSiteHost(card) ?? undefined) === args.urlHost);
