import type { PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { revealsHidden } from "../card/hiddenCards";
import {
  type ArchivedFilter,
  buildCardListQuery,
  buildFolderCardListQuery,
  buildHostCardListQuery,
  cardListScope,
  scopeArchivedMatch,
} from "../card/listQuery";
import { attachFileUrls } from "../card/queryUtils";
import { applyQuoteFormattingToList } from "../card/quoteFormatting";
import {
  cardHasTag,
  cardUrlHost,
  readExpressionText,
  resolveExpressionFolders,
} from "../card/searchPlanner";
import {
  loadSemanticMatches,
  searchCardsByDocument,
  searchCardsByExactTag,
  searchCardsByOcrText,
} from "../card/searchReads";
import { buildCardSearchText } from "../card/searchSync";
import {
  isSimilarAnchorAvailable,
  loadSimilarCards,
} from "../card/similarSearch";
import {
  doesCardMatchVisualFilters,
  normalizeVisualFilterArgs,
} from "../card/visualFilters";
import { searchModeValidator } from "../schema";
import {
  type SemanticRanking,
  semanticRankingValidator,
} from "../search/semanticCache";
import type { TeakUserId } from "../securitySessions";
import { clampPublicApiLimit } from "../shared/publicApiLimits";
import {
  expressionRevealTags,
  matchesExpression,
} from "../shared/search/expression";
import {
  matchesDoneState,
  matchesImageText,
  matchesPriceBounds,
  matchesSearchPhrases,
  type PriceBound,
  parseSearchQuery,
  type SearchExpression,
  type SearchSimilarity,
} from "../shared/search/qualifiers";
import {
  currentRelevanceScores,
  orderByRelevance,
  type RelevanceScore,
} from "../shared/search/relevance";
import {
  fuseRankings,
  SEMANTIC_MIN_SCORE,
  type SearchMode,
} from "../shared/search/semantic";
import { isCardHidden } from "../shared/tags";
import {
  type ApiCursor,
  encodeCursor,
  invalidCursorError,
  type ListAnchor,
  listAnchorOf,
  type MatchAnchor,
} from "./cursors";

export const MAX_QUERY_SCAN = 400;

export const apiCardSortValidator = v.union(
  v.literal("newest"),
  v.literal("oldest")
);
export type ApiCardSort = "newest" | "oldest";

export interface SearchOptions {
  archived?: ArchivedFilter;
  archivedInTrash?: boolean;
  createdAfter?: number;
  createdBefore?: number;
  done?: boolean;
  /** The search's exclusions and OR groups, checked on every card. */
  expression?: SearchExpression;
  /** The folders `expression` names, by name key; null for none. */
  expressionFolders?: ReadonlyMap<string, Id<"folders"> | null>;
  favorited?: boolean;
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  hexFilters?: string[];
  hueFilters?: string[];
  includeHidden?: boolean;
  keepSearchOrder?: boolean;
  limit?: number;
  ocrTexts?: string[];
  phrases?: string[];
  prices?: PriceBound[];
  /**
   * Hidden tags an OR branch asks for. A hidden card shows only when it has
   * one, unless the search's own tags already reveal hidden cards.
   */
  revealTags?: string[];
  searchQuery?: string;
  semantic?: { mode: SearchMode; ranking: SemanticRanking };
  showTrashOnly?: boolean;
  similarity?: { similarity: SearchSimilarity; ranking: SemanticRanking };
  sites?: string[];
  sort?: ApiCardSort;
  styleFilters?: string[];
  tag?: string;
  tags?: string[];
  todo?: boolean;
  type?: Doc<"cards">["type"];
  types?: Doc<"cards">["type"][];
}

export const normalizeSearchText = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeTag = (value?: string): string | undefined => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
};

export const normalizeSort = (value?: ApiCardSort): ApiCardSort =>
  value === "oldest" ? "oldest" : "newest";

export const normalizeCreatedTimestamp = (
  value?: number
): number | undefined => {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    return;
  }

  return value;
};

export const compareCards = (
  left: Pick<Doc<"cards">, "createdAt" | "_id">,
  right: Pick<Doc<"cards">, "createdAt" | "_id">,
  sort: ApiCardSort
): number => {
  if (left.createdAt === right.createdAt) {
    // Code-unit order, matching how indexes order ids, so keyset cursors
    // resume exactly where an index read stopped.
    const leftId = String(left._id);
    const rightId = String(right._id);
    if (leftId === rightId) {
      return 0;
    }
    const ascending = leftId < rightId ? -1 : 1;
    return sort === "oldest" ? ascending : -ascending;
  }

  return sort === "oldest"
    ? left.createdAt - right.createdAt
    : right.createdAt - left.createdAt;
};

export const matchesCreatedAt = (
  createdAt: number,
  options: Pick<SearchOptions, "createdAfter" | "createdBefore">
): boolean => {
  if (options.createdAfter !== undefined && createdAt < options.createdAfter) {
    return false;
  }

  if (
    options.createdBefore !== undefined &&
    createdAt > options.createdBefore
  ) {
    return false;
  }

  return true;
};

/**
 * `matchesStructuredFilters` for a card read without its search document:
 * a word in the expression reads the document's text when the card's own
 * fields leave some of it out.
 */
export const matchesStructuredFiltersWithText = async (
  ctx: QueryCtx,
  card: Doc<"cards">,
  options: SearchOptions
): Promise<boolean> =>
  matchesStructuredFilters(
    card,
    options,
    await readExpressionText(ctx, card, options.expression)
  );

export const matchesStructuredFilters = (
  card: Doc<"cards">,
  options: SearchOptions,
  searchableText?: string
): boolean => {
  if (
    isCardHidden(card) &&
    !(options.revealTags
      ? options.revealTags.some((tag) => cardHasTag(card, tag))
      : options.includeHidden)
  ) {
    return false;
  }
  if (options.folderId && !(card.folderIds ?? []).includes(options.folderId)) {
    return false;
  }
  if (options.type && card.type !== options.type) {
    return false;
  }
  if (options.types && !options.types.includes(card.type)) {
    return false;
  }

  if (
    options.favorited !== undefined &&
    Boolean(card.isFavorited) !== options.favorited
  ) {
    return false;
  }

  if (!matchesCreatedAt(card.createdAt, options)) {
    return false;
  }

  const requiredTags = [
    ...(options.tag ? [options.tag] : []),
    ...(options.tags ?? []),
  ];
  if (requiredTags.length > 0) {
    const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])];
    const tagSet = new Set(tags.map((tag) => tag.trim().toLowerCase()));
    if (!requiredTags.every((tag) => tagSet.has(tag))) {
      return false;
    }
  }

  if (
    options.folderIds?.some(
      (folderId) => !(card.folderIds ?? []).includes(folderId)
    )
  ) {
    return false;
  }

  if (options.sites?.length) {
    const host = cardUrlHost(card);
    if (!(host && options.sites.includes(host))) {
      return false;
    }
  }

  if (
    options.prices?.length &&
    !matchesPriceBounds(
      card.metadata?.linkCategory?.price?.amount,
      options.prices
    )
  ) {
    return false;
  }

  if (
    options.ocrTexts?.length &&
    !matchesImageText(card.aiOcrText, options.ocrTexts)
  ) {
    return false;
  }

  if (
    (options.done || options.todo) &&
    (card.type !== "link" ||
      !matchesDoneState(card, {
        done: options.done === true,
        todo: options.todo === true,
      }))
  ) {
    return false;
  }

  if (
    options.phrases?.length &&
    !matchesSearchPhrases(
      searchableText ?? buildCardSearchText(card),
      options.phrases
    )
  ) {
    return false;
  }

  if (options.archivedInTrash && card.isArchived !== true) {
    return false;
  }

  if (options.expression) {
    const folders = options.expressionFolders;
    const cardFolders = card.folderIds ?? [];
    if (
      !matchesExpression(
        options.expression,
        card,
        searchableText ?? buildCardSearchText(card),
        {
          folder: (name) => {
            const folderId = folders?.get(name);
            return Boolean(folderId && cardFolders.includes(folderId));
          },
          hasTag: (tag) => cardHasTag(card, tag),
          host: cardUrlHost(card),
        }
      )
    ) {
      return false;
    }
  }

  const archived = scopeArchivedMatch(
    cardListScope(options.archived, options.showTrashOnly)
  );
  if (
    archived !== "any" &&
    (card.isArchived === true) !== (archived === true)
  ) {
    return false;
  }

  return (
    Boolean(card.isDeleted) === Boolean(options.showTrashOnly) &&
    doesCardMatchVisualFilters(card, normalizeVisualFilterArgs(options))
  );
};

export const sortCards = (
  cards: Doc<"cards">[],
  sort: ApiCardSort
): Doc<"cards">[] =>
  cards.sort((left, right) => compareCards(left, right, sort));

export const isAfterMatchAnchor = (
  card: Doc<"cards">,
  anchor: MatchAnchor,
  sort: ApiCardSort
): boolean =>
  compareCards(
    card,
    { createdAt: anchor.createdAt, _id: anchor.id as Id<"cards"> },
    sort
  ) > 0;

const SEARCH_CANDIDATE_LIMIT = MAX_QUERY_SCAN;

export const searchCardsByQuery = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions
): Promise<{ cards: Doc<"cards">[]; hitScanBudget: boolean }> => {
  if (options.similarity) {
    const { similarity, ranking } = options.similarity;
    if (
      similarity.kind === "like" &&
      !(await isSimilarAnchorAvailable(ctx, userId, similarity.cardId))
    ) {
      return { cards: [], hitScanBudget: false };
    }
    const cards = await loadSimilarCards(ctx, {
      userId,
      similarity,
      ranking,
      keep: (card, searchableText) =>
        matchesStructuredFilters(card, options, searchableText),
      text: options.searchQuery ?? "",
    });
    return {
      cards: sortCards(cards, normalizeSort(options.sort)),
      hitScanBudget: false,
    };
  }
  const searchQuery = normalizeSearchText(options.searchQuery);
  const ocrText = options.ocrTexts?.join(" ") ?? "";
  if (!(searchQuery || ocrText)) {
    return { cards: [], hitScanBudget: false };
  }

  const typeGroups = options.types ?? [options.type];
  const scanBudget = { remaining: 4096, hitSearchLimit: false };
  const indexFilters = {
    userId,
    isDeleted: options.showTrashOnly ? true : undefined,
    archived: options.archived,
    isFavorited: options.favorited,
    urlHost: options.sites?.length === 1 ? options.sites[0] : undefined,
    includeHidden: options.includeHidden,
  };
  const { semantic } = options;
  const keywordSearch = semantic?.mode !== "semantic";
  const found: Doc<"cards">[][] = [];
  for (const type of keywordSearch ? typeGroups : []) {
    const read = {
      ...indexFilters,
      searchQuery: searchQuery ?? "",
      type,
      limit: SEARCH_CANDIDATE_LIMIT,
      scanBudget,
      resultFilter: (card: Doc<"cards">, searchableText: string) =>
        matchesStructuredFilters(card, options, searchableText),
    };
    if (!ocrText) {
      found.push(await searchCardsByDocument(ctx, read));
      continue;
    }
    const imageMatches = await searchCardsByOcrText(ctx, {
      ...read,
      searchQuery: ocrText,
    });
    const wordMatches = searchQuery
      ? new Set(
          (await searchCardsByDocument(ctx, read)).map((card) => card._id)
        )
      : null;
    found.push(
      wordMatches
        ? imageMatches.filter((card) => wordMatches.has(card._id))
        : imageMatches
    );
  }
  const unique = Array.from(
    new Map(found.flat().map((card) => [card._id, card] as const)).values()
  );
  if (!semantic) {
    return {
      cards: (options.keepSearchOrder
        ? unique
        : sortCards(unique, normalizeSort(options.sort))
      ).slice(0, MAX_QUERY_SCAN),
      hitScanBudget: scanBudget.hitSearchLimit,
    };
  }

  const keywordOrder: Id<"cards">[] = [];
  const longest = Math.max(0, ...found.map((group) => group.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const group of found) {
      const card = group[rank];
      if (card) {
        keywordOrder.push(card._id);
      }
    }
  }
  const cardsById = new Map(unique.map((card) => [card._id, card] as const));
  const matches = await loadSemanticMatches(
    ctx,
    { ...indexFilters, type: options.type },
    semantic.ranking,
    cardsById,
    {
      minScore: SEMANTIC_MIN_SCORE,
      keep: (card, searchableText) =>
        matchesStructuredFilters(card, options, searchableText),
      withText: Boolean(options.phrases?.length),
    }
  );
  const fused = fuseRankings(keywordOrder, matches, {
    mode: semantic.mode,
    limit: MAX_QUERY_SCAN,
  }).flatMap((cardId) => cardsById.get(cardId) ?? []);
  return {
    cards: options.keepSearchOrder
      ? fused
      : sortCards(fused, normalizeSort(options.sort)),
    hitScanBudget: scanBudget.hitSearchLimit,
  };
};

export const searchCardsByTag = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions,
  limit: number,
  anchor: MatchAnchor | undefined
): Promise<{ cards: Doc<"cards">[]; hasMore: boolean }> => {
  const tag = normalizeTag(options.tag);
  if (!tag) {
    return { cards: [], hasMore: false };
  }

  const sort = normalizeSort(options.sort);
  let createdAfter = options.createdAfter;
  let createdBefore = options.createdBefore;
  if (anchor && sort === "newest") {
    createdBefore = Math.min(
      createdBefore ?? anchor.createdAt,
      anchor.createdAt
    );
  } else if (anchor) {
    createdAfter = Math.max(createdAfter ?? anchor.createdAt, anchor.createdAt);
  }

  const typeGroups = options.types ?? [options.type];
  const scanBudget = { remaining: 4096 };
  const found = await Promise.all(
    typeGroups.map((type) =>
      searchCardsByExactTag(ctx, {
        userId,
        tag,
        isDeleted: options.showTrashOnly ? true : undefined,
        archived: options.archived,
        isFavorited: options.favorited,
        type,
        createdAfter,
        createdBefore,
        limit: limit + 1,
        scanBudget,
        sort,
        includeHidden: options.includeHidden,
        resultFilter: async (card) =>
          (!anchor || isAfterMatchAnchor(card, anchor, sort)) &&
          (await matchesStructuredFiltersWithText(ctx, card, options)),
      })
    )
  );
  const sorted = sortCards(
    Array.from(
      new Map(found.flat().map((card) => [card._id, card] as const)).values()
    ),
    sort
  );
  return { cards: sorted.slice(0, limit), hasMore: sorted.length > limit };
};

/**
 * Reads the `expression` text a search query carries and resolves the
 * folders it names.
 */
export const resolveQueryExpression = async (
  ctx: QueryCtx,
  userId: string,
  text: string | undefined
): Promise<{
  expression: SearchExpression | undefined;
  expressionFolders: ReadonlyMap<string, Id<"folders"> | null> | undefined;
}> => {
  const expression = text ? parseSearchQuery(text).expression : undefined;
  return {
    expression,
    expressionFolders: expression
      ? await resolveExpressionFolders(ctx, userId, expression)
      : undefined,
  };
};

export const normalizeCardsQueryOptions = (args: {
  archived?: ArchivedFilter;
  expression?: SearchExpression;
  expressionFolders?: ReadonlyMap<string, Id<"folders"> | null>;
  archivedInTrash?: boolean;
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  done?: boolean;
  ocrTexts?: string[];
  phrases?: string[];
  todo?: boolean;
  prices?: PriceBound[];
  sites?: string[];
  tags?: string[];
  showTrashOnly?: boolean;
  styleFilters?: string[];
  hueFilters?: string[];
  hexFilters?: string[];
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  limit?: number;
  searchQuery?: string;
  sort?: ApiCardSort;
  tag?: string;
  type?: Doc<"cards">["type"];
  types?: Doc<"cards">["type"][];
}): SearchOptions => {
  const tags = Array.from(
    new Set((args.tags ?? []).map(normalizeTag).filter(Boolean))
  ) as string[];
  const revealedByTags = revealsHidden([args.tag, ...tags]);
  const revealTags = revealedByTags
    ? []
    : expressionRevealTags(args.expression);
  const normalized: SearchOptions = {
    archived: args.archived,
    ...(args.expression
      ? {
          expression: args.expression,
          expressionFolders: args.expressionFolders,
        }
      : {}),
    ...(revealTags.length > 0 ? { revealTags } : {}),
    archivedInTrash: args.archivedInTrash === true && args.showTrashOnly,
    folderId: args.folderId,
    folderIds: args.folderIds?.length ? args.folderIds : undefined,
    done: args.done === true || undefined,
    todo: args.todo === true || undefined,
    ocrTexts: args.ocrTexts?.length ? args.ocrTexts : undefined,
    phrases: args.phrases?.length ? args.phrases : undefined,
    prices: args.prices?.length ? args.prices : undefined,
    sites: args.sites?.length ? args.sites : undefined,
    tags: tags.length ? tags : undefined,
    includeHidden: revealedByTags || revealTags.length > 0,
    showTrashOnly: args.showTrashOnly,
    ...normalizeVisualFilterArgs(args),
    createdAfter: normalizeCreatedTimestamp(args.createdAfter),
    createdBefore: normalizeCreatedTimestamp(args.createdBefore),
    favorited: args.favorited,
    limit: clampPublicApiLimit(args.limit),
    searchQuery: normalizeSearchText(args.searchQuery),
    sort: normalizeSort(args.sort),
    tag: normalizeTag(args.tag),
    type: args.type,
    types: args.types?.length ? args.types : undefined,
  };

  if (
    normalized.createdAfter !== undefined &&
    normalized.createdBefore !== undefined &&
    normalized.createdAfter > normalized.createdBefore
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "`createdAfter` must be less than or equal to `createdBefore`",
    });
  }

  return normalized;
};

export const priceBoundValidator = v.object({
  op: v.union(
    v.literal("<"),
    v.literal(">"),
    v.literal("<="),
    v.literal(">="),
    v.literal("=")
  ),
  amount: v.number(),
});

export const semanticSearchArgs = {
  semanticRanking: v.optional(semanticRankingValidator),
  mode: v.optional(searchModeValidator),
  similarity: v.optional(
    v.union(
      v.object({ kind: v.literal("like"), cardId: v.string() }),
      v.object({ kind: v.literal("mood"), text: v.string() })
    )
  ),
};

export const semanticOption = (args: {
  semanticRanking?: SemanticRanking;
  mode?: SearchMode;
  similarity?: SearchSimilarity;
}): SearchOptions["semantic"] =>
  args.semanticRanking && args.mode !== "keyword" && !args.similarity
    ? { mode: args.mode ?? "hybrid", ranking: args.semanticRanking }
    : undefined;

export const similarityOption = (args: {
  semanticRanking?: SemanticRanking;
  similarity?: SearchSimilarity;
}): SearchOptions["similarity"] =>
  args.similarity
    ? { similarity: args.similarity, ranking: args.semanticRanking ?? [] }
    : undefined;

const createBaseQuery = (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions,
  anchor?: ListAnchor
) => {
  const descending = normalizeSort(options.sort) === "newest";
  let lower = options.createdAfter;
  let upper = options.createdBefore;
  if (anchor && descending) {
    upper = Math.min(upper ?? anchor.createdAt, anchor.createdAt);
  } else if (anchor) {
    lower = Math.max(lower ?? anchor.createdAt, anchor.createdAt);
  }
  const host = options.sites?.length === 1 ? options.sites[0] : undefined;
  const scope = cardListScope(options.archived, options.showTrashOnly);
  if (host && (scope === "library" || scope === "archive")) {
    return buildHostCardListQuery(ctx, {
      userId,
      host,
      scope,
      createdAt: { gte: lower, lte: upper },
      includeHidden: options.includeHidden,
    });
  }
  return buildCardListQuery(ctx, {
    userId,
    includeHidden: options.includeHidden,
    scope,
    favoritesOnly: options.favorited === true,
    types: options.type ? [options.type] : options.types,
    createdAt: { gte: lower, lte: upper },
  });
};

const isAtOrBeforeListAnchor = (
  card: Doc<"cards">,
  anchor: ListAnchor | undefined,
  options: SearchOptions
): boolean => {
  if (!anchor) {
    return false;
  }
  if (card.createdAt !== anchor.createdAt) {
    return false;
  }
  return normalizeSort(options.sort) === "newest"
    ? card._creationTime >= anchor.creationTime
    : card._creationTime <= anchor.creationTime;
};

const scanFolderCards = async (
  ctx: QueryCtx,
  options: SearchOptions & { folderId: Id<"folders"> },
  anchor: ListAnchor | undefined,
  pageCursor: string | null,
  scanLimit: number
) => {
  const descending = normalizeSort(options.sort) === "newest";
  let lower = options.createdAfter;
  let upper = options.createdBefore;
  if (anchor && descending) {
    upper = Math.min(upper ?? anchor.createdAt, anchor.createdAt);
  } else if (anchor) {
    lower = Math.max(lower ?? anchor.createdAt, anchor.createdAt);
  }
  let page: PaginationResult<Doc<"folderCards">>;
  try {
    page = await buildFolderCardListQuery(ctx, {
      folderId: options.folderId,
      scope: cardListScope(options.archived, options.showTrashOnly),
      types: options.type ? [options.type] : options.types,
      createdAt: { gte: lower, lte: upper },
    })
      .order(descending ? "desc" : "asc")
      .paginate({
        cursor: pageCursor,
        maximumRowsRead: scanLimit,
        numItems: scanLimit,
      });
  } catch {
    throw invalidCursorError();
  }
  const matches: Doc<"cards">[] = [];
  const itemCursors: string[] = [];
  for (const row of page.page) {
    if (
      anchor &&
      row.cardCreatedAt === anchor.createdAt &&
      (descending
        ? row._creationTime >= anchor.creationTime
        : row._creationTime <= anchor.creationTime)
    ) {
      continue;
    }
    const card = await ctx.db.get("cards", row.cardId);
    if (
      !(card && (await matchesStructuredFiltersWithText(ctx, card, options)))
    ) {
      continue;
    }
    matches.push(card);
    itemCursors.push(
      encodeCursor({
        mode: "list",
        anchor: {
          createdAt: row.cardCreatedAt,
          creationTime: row._creationTime,
        },
      })
    );
  }
  return {
    itemCursors,
    matches,
    nextCursor:
      page.isDone || !page.continueCursor
        ? null
        : encodeCursor({
            mode: "list",
            ...(anchor ? { anchor } : {}),
            page: page.continueCursor,
          }),
    scannedRows: page.page.length,
  };
};

export const scanCardsWithBaseQuery = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions,
  decodedCursor: ApiCursor,
  scanLimit: number
) => {
  if (decodedCursor.mode === "match") {
    throw invalidCursorError();
  }
  if (options.folderId) {
    return scanFolderCards(
      ctx,
      { ...options, folderId: options.folderId },
      decodedCursor.mode === "list" ? decodedCursor.anchor : undefined,
      decodedCursor.mode === "list" ? (decodedCursor.page ?? null) : null,
      scanLimit
    );
  }
  const sort = normalizeSort(options.sort);
  const anchor =
    decodedCursor.mode === "list" ? decodedCursor.anchor : undefined;
  const pageCursor =
    decodedCursor.mode === "list" ? (decodedCursor.page ?? null) : null;

  let page: PaginationResult<Doc<"cards">>;
  try {
    page = await createBaseQuery(ctx, userId, options, anchor)
      .order(sort === "oldest" ? "asc" : "desc")
      .paginate({
        cursor: pageCursor,
        maximumRowsRead: scanLimit,
        numItems: scanLimit,
      });
  } catch {
    throw invalidCursorError();
  }
  const matches: Doc<"cards">[] = [];
  const itemCursors: string[] = [];

  for (const card of page.page) {
    if (
      isAtOrBeforeListAnchor(card, anchor, options) ||
      !(await matchesStructuredFiltersWithText(ctx, card, options))
    ) {
      continue;
    }

    matches.push(card);
    itemCursors.push(
      encodeCursor({ mode: "list", anchor: listAnchorOf(card) })
    );
  }

  return {
    itemCursors,
    matches,
    nextCursor:
      page.isDone || !page.continueCursor
        ? null
        : encodeCursor({
            mode: "list",
            ...(anchor ? { anchor } : {}),
            page: page.continueCursor,
          }),
    scannedRows: page.page.length,
  };
};

export const relevancePage = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions,
  {
    cursor,
    hasCursor,
    limit,
    scores,
  }: {
    cursor: ApiCursor;
    hasCursor: boolean;
    limit: number;
    scores: RelevanceScore[] | undefined;
  }
) => {
  const ranked = scores !== undefined;
  if (
    !(cursor.mode === "start" || cursor.mode === "relevance") ||
    (cursor.mode === "relevance" && cursor.ranked !== ranked)
  ) {
    throw invalidCursorError();
  }
  const result = await searchCardsByQuery(ctx, userId, {
    ...options,
    keepSearchOrder: true,
  });
  const ordered = ranked
    ? orderByRelevance(
        result.cards,
        currentRelevanceScores(scores, result.cards)
      )
    : result.cards;
  const offset = cursor.mode === "relevance" ? cursor.offset : 0;
  const pageItems = ordered.slice(offset, offset + limit);
  const hasMore = ordered.length > offset + limit;
  if (!(hasMore || hasCursor) && result.hitScanBudget) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Search is too broad. Add a type or date filter.",
    });
  }
  const nextCursor = hasMore
    ? encodeCursor({ mode: "relevance", offset: offset + limit, ranked })
    : null;
  const cardsWithUrls = await attachFileUrls(ctx, pageItems);
  return {
    items: applyQuoteFormattingToList(cardsWithUrls),
    pageInfo: { nextCursor, hasMore: nextCursor !== null },
  };
};
