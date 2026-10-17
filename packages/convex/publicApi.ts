import type { PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  applyCardAction,
  type BulkCardAction,
  normalizeBulkTags,
} from "./card/bulkActions";
import { createCardForUserHandler } from "./card/createCard";
import { cardReturnValidator } from "./card/getCards";
import { revealsHidden } from "./card/hiddenCards";
import {
  type ArchivedFilter,
  archivedFilterMatch,
  archivedFilterValidator,
  buildCardListQuery,
  buildFolderCardListQuery,
  buildHostCardListQuery,
  buildTagCardListQuery,
} from "./card/listQuery";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import {
  buildCardSearchText,
  loadSemanticMatches,
  searchCardsByDocument,
  searchCardsByExactTag,
} from "./card/searchDocumentHelpers";
import { cardUrlHost, resolveFolderNames } from "./card/searchPlanner";
import {
  pageShuffleWalk,
  type ShuffleWalkPosition,
  shuffleSegmentCount,
} from "./card/shuffle";
import {
  isSimilarAnchorAvailable,
  loadSimilarCards,
} from "./card/similarSearch";
import {
  type CardFieldEdit,
  updateCardFieldsForUserHandler,
} from "./card/updateCard";
import {
  doesCardMatchVisualFilters,
  normalizeVisualFilterArgs,
} from "./card/visualFilters";
import {
  explainCardTypeMismatch,
  explainInvalidTags,
} from "./publicApiHttpShared";
import {
  listCardTombstonesSince,
  type TombstoneCursor,
} from "./publicApiTombstones";
import { cardTypeValidator, searchModeValidator } from "./schema";
import { relevanceScoreValidator } from "./search/relevanceCache";
import {
  type SemanticRanking,
  semanticRankingValidator,
} from "./search/semanticCache";
import { requireTeakUserId, type TeakUserId } from "./securitySessions";
import { type CardType, cardTypes } from "./shared/constants";
import { rateLimiter } from "./shared/rateLimits";
import {
  matchesPriceBounds,
  matchesSearchPhrases,
  type PriceBound,
  type SearchSimilarity,
} from "./shared/search/qualifiers";
import {
  currentRelevanceScores,
  orderByRelevance,
  type RelevanceScore,
} from "./shared/search/relevance";
import {
  fuseRankings,
  SEMANTIC_MIN_SCORE,
  type SearchMode,
} from "./shared/search/semantic";
import {
  isShuffleSeed,
  shuffleBySeed,
  shuffleRank,
} from "./shared/search/shuffle";
import { isCardHidden } from "./shared/tags";
import { isSafeExternalUrl, UnsafeUrlError } from "./shared/utils/safeUrl";
import { queueCardProcessing } from "./workflowDispatch";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_QUERY_SCAN = 400;
const MAX_BULK_ITEMS = 100;

const apiCardSortValidator = v.union(v.literal("newest"), v.literal("oldest"));
type ApiCardSort = "newest" | "oldest";

const pageInfoValidator = v.object({
  nextCursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

const paginatedCardsResultValidator = v.object({
  items: v.array(cardReturnValidator),
  pageInfo: pageInfoValidator,
  total: v.optional(v.number()),
});

const scannedCardsResultValidator = v.object({
  itemCursors: v.array(v.string()),
  items: v.array(cardReturnValidator),
  nextCursor: v.union(v.string(), v.null()),
  scannedRows: v.number(),
});

const changesResultValidator = v.object({
  items: v.array(cardReturnValidator),
  deletedIds: v.array(v.id("cards")),
  pageInfo: pageInfoValidator,
});

const tagSummaryValidator = v.object({
  name: v.string(),
  count: v.number(),
});

const bulkResultValidator = v.object({
  operation: v.union(
    v.literal("create"),
    v.literal("update"),
    v.literal("favorite"),
    v.literal("delete"),
    v.literal("archive"),
    v.literal("unarchive"),
    v.literal("addTags"),
    v.literal("removeTags"),
    v.literal("restore")
  ),
  results: v.array(v.any()),
  failedIds: v.array(v.string()),
  summary: v.object({
    total: v.number(),
    succeeded: v.number(),
    failed: v.number(),
  }),
});

interface SearchOptions {
  archived?: ArchivedFilter;
  archivedInTrash?: boolean;
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  hexFilters?: string[];
  hueFilters?: string[];
  /** The search names a reserved tag, so hidden cards are in it. */
  includeHidden?: boolean;
  /** Best match: keep the search's own order instead of sorting by date. */
  keepSearchOrder?: boolean;
  limit?: number;
  phrases?: string[];
  /** `price:` bounds a card's link price must all meet. */
  prices?: PriceBound[];
  searchQuery?: string;
  /** Meaning matches to fuse with the keyword ones, and how. */
  semantic?: { mode: SearchMode; ranking: SemanticRanking };
  showTrashOnly?: boolean;
  /** `like:` or `mood:`: list only these meaning matches. */
  similarity?: { similarity: SearchSimilarity; ranking: SemanticRanking };
  sites?: string[];
  sort?: ApiCardSort;
  styleFilters?: string[];
  tag?: string;
  tags?: string[];
  type?: Doc<"cards">["type"];
  types?: Doc<"cards">["type"][];
}

interface ListAnchor {
  createdAt: number;
  creationTime: number;
}

interface MatchAnchor {
  createdAt: number;
  id: string;
}

type ApiCursor =
  | { mode: "start" }
  | { mode: "list"; anchor?: ListAnchor; page?: string }
  | { mode: "match"; anchor: MatchAnchor }
  // Cursors issued before keyset paging. Still accepted so a client that is
  // mid-pagination during a deploy can finish.
  | { mode: "index"; cursor: string | null; pageOffset: number }
  | { mode: "offset"; offset: number }
  // Best match pages: an offset into the search's order, and whether that
  // order was scored, fixed by the first page for the whole pagination.
  | { mode: "relevance"; offset: number; ranked: boolean };

const normalizeLimit = (limit?: number): number => {
  if (!(typeof limit === "number" && Number.isFinite(limit))) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(limit, MAX_LIMIT));
};

const normalizeSearchText = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeTag = (value?: string): string | undefined => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
};

const normalizeSort = (value?: ApiCardSort): ApiCardSort =>
  value === "oldest" ? "oldest" : "newest";

const normalizeCreatedTimestamp = (value?: number): number | undefined => {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    return;
  }

  return value;
};

const compareCards = (
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

const matchesCreatedAt = (
  createdAt: number,
  options: SearchOptions
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

const matchesStructuredFilters = (
  card: Doc<"cards">,
  options: SearchOptions,
  searchableText?: string
): boolean => {
  if (!options.includeHidden && isCardHidden(card)) {
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

  const archived = archivedFilterMatch(options.archived, options.showTrashOnly);
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

const sortCards = (cards: Doc<"cards">[], sort: ApiCardSort): Doc<"cards">[] =>
  cards.sort((left, right) => compareCards(left, right, sort));

const invalidCursorError = () =>
  new ConvexError({
    code: "INVALID_INPUT",
    message: "Query parameter `cursor` is invalid",
  });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const encodeCursor = (cursor: ApiCursor): string =>
  btoa(JSON.stringify(cursor));

const decodeCursor = (cursor?: string): ApiCursor => {
  if (!cursor) {
    return { mode: "start" };
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw invalidCursorError();
  }
  if (!parsed || typeof parsed !== "object") {
    throw invalidCursorError();
  }

  switch (parsed.mode) {
    case "list": {
      const anchor = parsed.anchor as Record<string, unknown> | undefined;
      const page = parsed.page;
      if (
        (anchor !== undefined &&
          !(
            isFiniteNumber(anchor?.createdAt) &&
            isFiniteNumber(anchor.creationTime)
          )) ||
        (page !== undefined && typeof page !== "string")
      ) {
        break;
      }
      return {
        mode: "list",
        ...(anchor
          ? {
              anchor: {
                createdAt: anchor.createdAt as number,
                creationTime: anchor.creationTime as number,
              },
            }
          : {}),
        ...(typeof page === "string" ? { page } : {}),
      };
    }
    case "match": {
      const anchor = parsed.anchor as Record<string, unknown> | undefined;
      if (isFiniteNumber(anchor?.createdAt) && typeof anchor.id === "string") {
        return {
          mode: "match",
          anchor: { createdAt: anchor.createdAt, id: anchor.id },
        };
      }
      break;
    }
    case "offset":
      if (isFiniteNumber(parsed.offset)) {
        return { mode: "offset", offset: Math.max(0, parsed.offset) };
      }
      break;
    case "relevance":
      if (isFiniteNumber(parsed.offset) && typeof parsed.ranked === "boolean") {
        return {
          mode: "relevance",
          offset: Math.max(0, Math.floor(parsed.offset)),
          ranked: parsed.ranked,
        };
      }
      break;
    case "index":
      if (
        (parsed.cursor === null || typeof parsed.cursor === "string") &&
        isFiniteNumber(parsed.pageOffset)
      ) {
        return {
          mode: "index",
          cursor: parsed.cursor,
          pageOffset: Math.max(0, parsed.pageOffset),
        };
      }
      break;
    default:
      break;
  }
  throw invalidCursorError();
};

const matchAnchorOf = (card: Doc<"cards">): MatchAnchor => ({
  createdAt: card.createdAt,
  id: String(card._id),
});

const listAnchorOf = (card: Doc<"cards">): ListAnchor => ({
  createdAt: card.createdAt,
  creationTime: card._creationTime,
});

const isAfterMatchAnchor = (
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

const searchCardsByQuery = async (
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
      keep: (card) => matchesStructuredFilters(card, options),
      text: options.searchQuery ?? "",
    });
    return {
      cards: sortCards(cards, normalizeSort(options.sort)),
      hitScanBudget: false,
    };
  }
  const searchQuery = normalizeSearchText(options.searchQuery);
  if (!searchQuery) {
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
  // Semantic mode reads only meaning matches once it has them.
  const keywordSearch = semantic?.mode !== "semantic";
  const found: Doc<"cards">[][] = [];
  for (const type of keywordSearch ? typeGroups : []) {
    found.push(
      await searchCardsByDocument(ctx, {
        ...indexFilters,
        searchQuery,
        type,
        limit: SEARCH_CANDIDATE_LIMIT,
        scanBudget,
        resultFilter: (card, searchableText) =>
          matchesStructuredFilters(card, options, searchableText),
      })
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

  // Fusion picks which cards are in the set; the sort orders it. Each type
  // group is in relevance order, so they interleave by rank.
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
      keep: (card) => matchesStructuredFilters(card, options),
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

const searchCardsByTag = async (
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
        resultFilter: (card) =>
          matchesStructuredFilters(card, options) &&
          (!anchor || isAfterMatchAnchor(card, anchor, sort)),
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
  if (host && !options.showTrashOnly && options.archived !== "include") {
    return buildHostCardListQuery(ctx, {
      userId,
      host,
      archived: options.archived === "only" ? "only" : "exclude",
      createdAt: { gte: lower, lte: upper },
      includeHidden: options.includeHidden,
    });
  }
  return buildCardListQuery(ctx, {
    userId,
    includeHidden: options.includeHidden,
    trash: options.showTrashOnly,
    archived: options.archived,
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
      trash: options.showTrashOnly,
      archived: options.archived,
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
    if (!(card && matchesStructuredFilters(card, options))) {
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

const scanCardsWithBaseQuery = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions,
  decodedCursor: ApiCursor,
  scanLimit: number
) => {
  if (decodedCursor.mode === "offset" || decodedCursor.mode === "match") {
    throw invalidCursorError();
  }
  if (options.folderId) {
    if (decodedCursor.mode === "index") {
      throw invalidCursorError();
    }
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
  let pageCursor: string | null = null;
  if (decodedCursor.mode === "list") {
    pageCursor = decodedCursor.page ?? null;
  } else if (decodedCursor.mode === "index") {
    pageCursor = decodedCursor.cursor;
  }
  const pageOffset =
    decodedCursor.mode === "index" ? decodedCursor.pageOffset : 0;

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
  let filteredIndex = 0;

  for (const card of page.page) {
    if (
      isAtOrBeforeListAnchor(card, anchor, options) ||
      !matchesStructuredFilters(card, options)
    ) {
      continue;
    }

    // Legacy offset cursors skip the matches they already served.
    if (filteredIndex < pageOffset) {
      filteredIndex += 1;
      continue;
    }

    filteredIndex += 1;
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

const normalizeCardsQueryOptions = (args: {
  archived?: ArchivedFilter;
  archivedInTrash?: boolean;
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  phrases?: string[];
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
  const normalized: SearchOptions = {
    archived: args.archived,
    archivedInTrash: args.archivedInTrash === true && args.showTrashOnly,
    folderId: args.folderId,
    folderIds: args.folderIds?.length ? args.folderIds : undefined,
    phrases: args.phrases?.length ? args.phrases : undefined,
    prices: args.prices?.length ? args.prices : undefined,
    sites: args.sites?.length ? args.sites : undefined,
    tags: tags.length ? tags : undefined,
    includeHidden: revealsHidden([args.tag, ...tags]),
    showTrashOnly: args.showTrashOnly,
    ...normalizeVisualFilterArgs(args),
    createdAfter: normalizeCreatedTimestamp(args.createdAfter),
    createdBefore: normalizeCreatedTimestamp(args.createdBefore),
    favorited: args.favorited,
    limit: normalizeLimit(args.limit),
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

/**
 * A search's meaning matches, which the HTTP handler fetched first (queries
 * cannot call the vector service), and the search mode. Without a ranking a
 * search is keyword-only, whatever the mode.
 */
/** A `price:` bound from `q` (shared/search/qualifiers.ts). */
const priceBoundValidator = v.object({
  op: v.union(
    v.literal("<"),
    v.literal(">"),
    v.literal("<="),
    v.literal(">="),
    v.literal("=")
  ),
  amount: v.number(),
});

const semanticSearchArgs = {
  semanticRanking: v.optional(semanticRankingValidator),
  mode: v.optional(searchModeValidator),
  /** With `semanticRanking`, a `like:` or `mood:` search: list only those. */
  similarity: v.optional(
    v.union(
      v.object({ kind: v.literal("like"), cardId: v.string() }),
      v.object({ kind: v.literal("mood"), text: v.string() })
    )
  ),
};

const semanticOption = (args: {
  semanticRanking?: SemanticRanking;
  mode?: SearchMode;
  similarity?: SearchSimilarity;
}): SearchOptions["semantic"] =>
  args.semanticRanking && args.mode !== "keyword" && !args.similarity
    ? { mode: args.mode ?? "hybrid", ranking: args.semanticRanking }
    : undefined;

/**
 * One page of a Best match search. The order is the search's own, scored
 * first when scores are given; the cursor carries whether it was scored, so
 * a pagination never switches order between pages.
 */
const relevancePage = async (
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

/**
 * Whether a Best match cursor's pagination is scored; undefined for the
 * first page and for any other cursor.
 */
export const relevanceCursorRanked = (
  cursor: string | undefined
): boolean | undefined => {
  if (!cursor) {
    return;
  }
  try {
    const decoded = decodeCursor(cursor);
    return decoded.mode === "relevance" ? decoded.ranked : undefined;
  } catch {}
};

const similarityOption = (args: {
  semanticRanking?: SemanticRanking;
  similarity?: SearchSimilarity;
}): SearchOptions["similarity"] =>
  args.similarity
    ? { similarity: args.similarity, ranking: args.semanticRanking ?? [] }
    : undefined;

export const searchCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    searchQuery: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    tag: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    limit: v.optional(v.number()),
    ...semanticSearchArgs,
    /**
     * Best match for a search: keep the search's own order, scored first
     * when `scores` (fetched by the HTTP handler) are given.
     */
    relevance: v.optional(
      v.object({ scores: v.optional(v.array(relevanceScoreValidator)) })
    ),
  },
  returns: paginatedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
    }
    const options = {
      ...normalizeCardsQueryOptions({ ...args, folderIds }),
      semantic: semanticOption(args),
      similarity: similarityOption(args),
    };
    const limit = normalizeLimit(options.limit);
    const sort = normalizeSort(options.sort);
    const decodedCursor = decodeCursor(args.cursor);
    if (
      decodedCursor.mode === "list" ||
      decodedCursor.mode === "index" ||
      (decodedCursor.mode === "relevance" && !args.relevance)
    ) {
      throw invalidCursorError();
    }
    if (args.relevance && options.searchQuery) {
      return await relevancePage(ctx, userId, options, {
        cursor: decodedCursor,
        hasCursor: Boolean(args.cursor),
        limit,
        scores: args.relevance.scores,
      });
    }
    const anchor =
      decodedCursor.mode === "match" ? decodedCursor.anchor : undefined;
    let pageItems: Doc<"cards">[];
    let hasMore: boolean;

    if (options.searchQuery || options.similarity) {
      const result = await searchCardsByQuery(ctx, userId, options);
      let remaining = result.cards;
      if (decodedCursor.mode === "offset") {
        remaining = remaining.slice(decodedCursor.offset);
      } else if (anchor) {
        remaining = remaining.filter((card) =>
          isAfterMatchAnchor(card, anchor, sort)
        );
      }
      pageItems = remaining.slice(0, limit);
      hasMore = remaining.length > limit;
      if (!(hasMore || args.cursor) && result.hitScanBudget) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Search is too broad. Add a type or date filter.",
        });
      }
    } else if (decodedCursor.mode === "offset") {
      // Legacy offset cursor: read through the offset once, then continue
      // with keyset cursors.
      const result = await searchCardsByTag(
        ctx,
        userId,
        options,
        decodedCursor.offset + limit,
        undefined
      );
      pageItems = result.cards.slice(decodedCursor.offset);
      hasMore = result.hasMore;
    } else {
      const result = await searchCardsByTag(
        ctx,
        userId,
        options,
        limit,
        anchor
      );
      pageItems = result.cards;
      hasMore = result.hasMore;
    }

    const last = pageItems[pageItems.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ mode: "match", anchor: matchAnchorOf(last) })
        : null;
    const cardsWithUrls = await attachFileUrls(ctx, pageItems);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      pageInfo: {
        nextCursor,
        hasMore: nextCursor !== null,
      },
    };
  },
});

type ShuffleApiCursor =
  | { mode: "start" }
  | { mode: "walk"; position: ShuffleWalkPosition }
  | { mode: "after"; rank: number; id: string };

const encodeShuffleCursor = (
  seed: number,
  cursor: Exclude<ShuffleApiCursor, { mode: "start" }>
): string =>
  btoa(
    JSON.stringify(
      cursor.mode === "walk"
        ? { mode: "shuffle", seed, position: cursor.position }
        : { mode: "shuffle", seed, rank: cursor.rank, id: cursor.id }
    )
  );

const decodeShuffleCursor = (
  seed: number,
  cursor: string | undefined
): ShuffleApiCursor => {
  if (!cursor) {
    return { mode: "start" };
  }
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw invalidCursorError();
  }
  if (parsed?.mode !== "shuffle" || parsed.seed !== seed) {
    throw invalidCursorError();
  }
  if (parsed.position && typeof parsed.position === "object") {
    const position = parsed.position as Record<string, unknown>;
    if (
      typeof position.segment === "number" &&
      Number.isInteger(position.segment) &&
      position.segment >= 0 &&
      (position.page === null || typeof position.page === "string")
    ) {
      return {
        mode: "walk",
        position: { segment: position.segment, page: position.page },
      };
    }
  }
  if (isFiniteNumber(parsed.rank) && typeof parsed.id === "string") {
    return { mode: "after", rank: parsed.rank, id: parsed.id };
  }
  throw invalidCursorError();
};

const isAfterShuffleAnchor = (
  seed: number,
  id: string,
  anchor: { rank: number; id: string }
) => {
  const rank = shuffleRank(seed, id);
  return rank > anchor.rank || (rank === anchor.rank && id > anchor.id);
};

const SHUFFLE_SET_ROWS = 2000;
const SHUFFLE_SET_LOADS = MAX_QUERY_SCAN;
const SHUFFLE_WALK_SCAN = MAX_QUERY_SCAN;

export const shuffleCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    shuffleSeed: v.number(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    searchQuery: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    tag: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    limit: v.optional(v.number()),
    ...semanticSearchArgs,
  },
  returns: paginatedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    if (!isShuffleSeed(args.shuffleSeed)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Query parameter `shuffleSeed` must be a whole number from 0 to 2147483647",
      });
    }
    const seed = args.shuffleSeed;
    const empty = { items: [], pageInfo: { nextCursor: null, hasMore: false } };
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return empty;
    }
    const options = {
      ...normalizeCardsQueryOptions({ ...args, folderIds, sort: "newest" }),
      semantic: semanticOption(args),
      similarity: similarityOption(args),
    };
    const limit = normalizeLimit(options.limit);
    const cursor = decodeShuffleCursor(seed, args.cursor);
    const respond = async (
      items: Doc<"cards">[],
      next: Exclude<ShuffleApiCursor, { mode: "start" }> | null
    ) => {
      const cardsWithUrls = await attachFileUrls(ctx, items);
      const nextCursor = next ? encodeShuffleCursor(seed, next) : null;
      return {
        items: applyQuoteFormattingToList(cardsWithUrls),
        pageInfo: { nextCursor, hasMore: nextCursor !== null },
      };
    };

    const setPage = (cards: Doc<"cards">[]) => {
      if (cursor.mode === "walk") {
        throw invalidCursorError();
      }
      const ordered = shuffleBySeed(cards, seed, (card) => card._id);
      const remaining =
        cursor.mode === "after"
          ? ordered.filter((card) =>
              isAfterShuffleAnchor(seed, card._id, cursor)
            )
          : ordered;
      const items = remaining.slice(0, limit);
      const last = items[items.length - 1];
      return respond(
        items,
        remaining.length > limit && last
          ? { mode: "after", rank: shuffleRank(seed, last._id), id: last._id }
          : null
      );
    };

    const idSetPage = async (cardIds: readonly Id<"cards">[]) => {
      if (cursor.mode === "walk") {
        throw invalidCursorError();
      }
      const ordered = shuffleBySeed([...new Set(cardIds)], seed, (id) => id);
      const remaining =
        cursor.mode === "after"
          ? ordered.filter((id) => isAfterShuffleAnchor(seed, id, cursor))
          : ordered;
      const items: Doc<"cards">[] = [];
      let examined = 0;
      while (
        examined < remaining.length &&
        items.length < limit &&
        examined < SHUFFLE_SET_LOADS
      ) {
        const card = await ctx.db.get("cards", remaining[examined]);
        examined += 1;
        if (
          card &&
          card.userId === userId &&
          matchesStructuredFilters(card, options)
        ) {
          items.push(card);
        }
      }
      const lastId = remaining[examined - 1];
      return respond(
        items,
        examined < remaining.length && lastId
          ? { mode: "after", rank: shuffleRank(seed, lastId), id: lastId }
          : null
      );
    };
    const createdAt = {
      gte: options.createdAfter,
      lte: options.createdBefore,
    };
    const types = options.type ? [options.type] : options.types;

    if (options.searchQuery || options.similarity) {
      return setPage((await searchCardsByQuery(ctx, userId, options)).cards);
    }
    const tag = normalizeTag(options.tag);
    if (tag) {
      const rows = await buildTagCardListQuery(ctx, {
        userId,
        tag,
        trash: options.showTrashOnly,
        archived: options.archived,
        types,
        favoritesOnly: options.favorited === true,
        createdAt,
      })
        .order("desc")
        .take(SHUFFLE_SET_ROWS);
      return idSetPage(rows.map((row) => row.cardId));
    }
    if (options.folderId) {
      const rows = await buildFolderCardListQuery(ctx, {
        folderId: options.folderId,
        trash: options.showTrashOnly,
        archived: options.archived,
        types,
        createdAt,
      })
        .order("desc")
        .take(SHUFFLE_SET_ROWS);
      return idSetPage(rows.map((row) => row.cardId));
    }

    if (cursor.mode === "after") {
      throw invalidCursorError();
    }
    const walk = {
      userId,
      seed,
      includeHidden: options.includeHidden,
      trash: options.showTrashOnly,
      archived: options.archived,
      favoritesOnly: options.favorited === true,
      types: options.type ? [options.type] : options.types,
      createdAt: {
        gte: options.createdAfter,
        lte: options.createdBefore,
      },
    };
    const position =
      cursor.mode === "walk" ? cursor.position : { segment: 0, page: null };
    if (position.segment >= shuffleSegmentCount(walk)) {
      throw invalidCursorError();
    }
    let result: Awaited<ReturnType<typeof pageShuffleWalk>>;
    try {
      result = await pageShuffleWalk(ctx, walk, position, {
        numItems: limit,
        maximumRowsRead: SHUFFLE_WALK_SCAN,
      });
    } catch {
      throw invalidCursorError();
    }
    return respond(
      result.cards.filter((card) => matchesStructuredFilters(card, options)),
      result.next ? { mode: "walk", position: result.next } : null
    );
  },
});

export const scanCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    scanLimit: v.number(),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
  },
  returns: scannedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return { itemCursors: [], items: [], nextCursor: null, scannedRows: 0 };
    }
    const [firstFolder, ...otherFolders] = folderIds;
    const options = normalizeCardsQueryOptions({
      ...args,
      folderId: args.folderId ?? firstFolder,
      folderIds: args.folderId ? folderIds : otherFolders,
    });
    const scanLimit = normalizeLimit(args.scanLimit);
    const page = await scanCardsWithBaseQuery(
      ctx,
      userId,
      options,
      decodeCursor(args.cursor),
      scanLimit
    );
    const cardsWithUrls = await attachFileUrls(ctx, page.matches);

    return {
      itemCursors: page.itemCursors,
      items: applyQuoteFormattingToList(cardsWithUrls),
      nextCursor: page.nextCursor,
      scannedRows: page.scannedRows,
    };
  },
});

const MAX_TAG_ROWS_READ = 8000;
// Most distinct tags one listing counts. Each is two index lookups, and a
// function may only make so many, so a vault of many small tags stops here
// (GET /v1/tags then answers from the background tag summary).
const MAX_TAGS_READ = 500;

export const listTagsForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    items: v.array(tagSummaryValidator),
    isComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const counts: { name: string; count: number }[] = [];
    let budget = MAX_TAG_ROWS_READ;
    let tagsLeft = MAX_TAGS_READ;
    let isComplete = true;
    let previousTag: string | undefined;

    while (isComplete) {
      if (tagsLeft <= 0) {
        const more = await ctx.db
          .query("cardSearchTags")
          .withIndex("by_user_tag_deleted_created", (query) =>
            previousTag === undefined
              ? query.eq("userId", userId)
              : query.eq("userId", userId).gt("tag", previousTag)
          )
          .first();
        isComplete = more === null;
        break;
      }
      tagsLeft -= 1;
      const afterTag = previousTag;
      const next = await ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_created", (query) =>
          afterTag === undefined
            ? query.eq("userId", userId)
            : query.eq("userId", userId).gt("tag", afterTag)
        )
        .first();
      if (!next) {
        break;
      }
      budget -= 1;
      previousTag = next.tag;

      let count = 0;
      const activeRows = ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_archived_created_v2", (query) =>
          query
            .eq("userId", userId)
            .eq("tag", next.tag)
            .eq("isDeleted", undefined)
            .eq("isArchived", undefined)
        );
      for await (const _row of activeRows) {
        if (budget <= 0) {
          isComplete = false;
          break;
        }
        budget -= 1;
        count += 1;
      }
      if (count > 0) {
        counts.push({ name: next.tag, count });
      }
      if (budget <= 0) {
        isComplete = false;
      }
    }

    return {
      items: counts.sort((left, right) => {
        if (left.count === right.count) {
          return left.name.localeCompare(right.name);
        }
        return right.count - left.count;
      }),
      isComplete,
    };
  },
});

type ChangesCursor =
  | { phase: "cards"; cursor: string | null }
  | { phase: "tombstones"; after?: TombstoneCursor };

const encodeChangesCursor = (cursor: ChangesCursor): string =>
  btoa(JSON.stringify({ v: 2, ...cursor }));

const decodeChangesCursor = (cursor?: string): ChangesCursor => {
  if (!cursor) {
    return { phase: "cards", cursor: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    // Cursors issued before tombstones were raw card-page cursors.
    return { phase: "cards", cursor };
  }
  const value = parsed as Record<string, unknown> | null;
  if (value?.v !== 2) {
    throw invalidCursorError();
  }
  if (
    value.phase === "cards" &&
    (value.cursor === null || typeof value.cursor === "string")
  ) {
    return { phase: "cards", cursor: value.cursor };
  }
  if (value.phase === "tombstones") {
    const after = value.after as Record<string, unknown> | undefined;
    if (after === undefined) {
      return { phase: "tombstones" };
    }
    if (
      typeof after?.deletedAt === "number" &&
      typeof after.creationTime === "number"
    ) {
      return {
        phase: "tombstones",
        after: {
          creationTime: after.creationTime,
          deletedAt: after.deletedAt,
        },
      };
    }
  }
  throw invalidCursorError();
};

export const listCardChangesForUser = internalQuery({
  args: {
    userId: v.string(),
    since: v.number(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: changesResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const limit = normalizeLimit(args.limit);
    const decoded = decodeChangesCursor(args.cursor);
    let activeCards: Doc<"cards">[] = [];
    const deletedIds: Id<"cards">[] = [];
    let tombstoneAfter: TombstoneCursor | undefined;

    if (decoded.phase === "cards") {
      let page: PaginationResult<Doc<"cards">>;
      try {
        page = await ctx.db
          .query("cards")
          .withIndex("by_updated", (query) =>
            query.eq("userId", userId).gte("updatedAt", args.since)
          )
          .order("asc")
          .paginate({ cursor: decoded.cursor, numItems: limit });
      } catch {
        throw invalidCursorError();
      }
      activeCards = page.page.filter((card) => !card.isDeleted);
      for (const card of page.page) {
        if (card.isDeleted) {
          deletedIds.push(card._id);
        }
      }
      if (!page.isDone) {
        const cardsWithUrls = await attachFileUrls(ctx, activeCards);
        return {
          items: applyQuoteFormattingToList(cardsWithUrls),
          deletedIds,
          pageInfo: {
            nextCursor: encodeChangesCursor({
              phase: "cards",
              cursor: page.continueCursor,
            }),
            hasMore: true,
          },
        };
      }
    } else {
      tombstoneAfter = decoded.after;
    }

    const remaining = limit - activeCards.length - deletedIds.length;
    let hasMore = false;
    let nextCursor: string | null = null;
    if (remaining <= 0) {
      hasMore = true;
      nextCursor = encodeChangesCursor({ phase: "tombstones" });
    } else {
      const tombstones = await listCardTombstonesSince(ctx, {
        after: tombstoneAfter,
        limit: remaining,
        since: args.since,
        userId,
      });
      for (const row of tombstones.rows) {
        deletedIds.push(row.cardId);
      }
      const last = tombstones.rows[tombstones.rows.length - 1];
      if (tombstones.hasMore && last) {
        hasMore = true;
        nextCursor = encodeChangesCursor({
          phase: "tombstones",
          after: {
            creationTime: last._creationTime,
            deletedAt: last.deletedAt,
          },
        });
      }
    }

    const cardsWithUrls = await attachFileUrls(ctx, activeCards);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      deletedIds,
      pageInfo: { nextCursor, hasMore },
    };
  },
});

type BulkOperation =
  | "create"
  | "update"
  | "favorite"
  | "delete"
  | "archive"
  | "unarchive"
  | "addTags"
  | "removeTags"
  | "restore";

const performBulkUpdate = async (
  ctx: MutationCtx,
  args: {
    userId: TeakUserId;
    cardId: Id<"cards">;
    content?: string;
    url?: string;
    notes?: string | null;
    tags?: string[];
  }
) => {
  const edits: CardFieldEdit[] = [];
  if (args.content !== undefined) {
    edits.push({ field: "content", value: args.content });
  }
  if (args.url !== undefined) {
    edits.push({ field: "url", value: args.url });
  }
  if (args.notes !== undefined) {
    edits.push({ field: "notes", value: args.notes });
  }
  if (args.tags !== undefined) {
    edits.push({ field: "tags", value: args.tags });
  }

  const result = await updateCardFieldsForUserHandler(
    ctx,
    { userId: args.userId, cardId: args.cardId, edits },
    { deferPipelineSchedule: true }
  );
  return result.pipelineDelayMs;
};

const assertBulkCreatePayload = (payload: Record<string, unknown>) => {
  const content =
    typeof payload.content === "string" ? payload.content : undefined;
  const url = typeof payload.url === "string" ? payload.url.trim() : undefined;
  const type =
    typeof payload.cardType === "string" ? payload.cardType : undefined;

  if (content === undefined && !url) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item must include `content` or `url`",
    });
  }
  if (type !== "text" && !url && !content?.trim()) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item must include `content` or `url`",
    });
  }

  if (type && !cardTypes.includes(type as CardType)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item `cardType` must be a valid card type",
    });
  }

  if (url && !isSafeExternalUrl(url)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item `url` must use the http or https scheme",
    });
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((value): value is string => typeof value === "string")
    : undefined;
  const createError =
    explainInvalidTags(tags) ??
    (url
      ? null
      : explainCardTypeMismatch({
          cardType: type,
          content,
          notes: typeof payload.notes === "string" ? payload.notes : undefined,
          tags,
        }));
  if (createError) {
    throw new ConvexError({ code: "INVALID_INPUT", message: createError });
  }
};

const assertBulkFavoritePayload = (payload: Record<string, unknown>) => {
  if (typeof payload.isFavorited !== "boolean") {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each favorite item must include `isFavorited` as a boolean",
    });
  }
};

export const executeBulkCardsForUser = internalMutation({
  args: {
    userId: v.string(),
    operation: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("favorite"),
      v.literal("delete"),
      v.literal("archive"),
      v.literal("unarchive"),
      v.literal("addTags"),
      v.literal("removeTags"),
      v.literal("restore")
    ),
    items: v.array(v.any()),
  },
  returns: bulkResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    if (args.items.length > MAX_BULK_ITEMS) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `\`items\` must not exceed ${MAX_BULK_ITEMS} entries per request`,
      });
    }

    const results: Record<string, unknown>[] = [];
    const failedIds: string[] = [];
    let succeeded = 0;

    for (const [index, item] of args.items.entries()) {
      try {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: "Each bulk item must be an object",
          });
        }

        const payload = item as Record<string, unknown>;

        switch (args.operation as BulkOperation) {
          case "create": {
            assertBulkCreatePayload(payload);
            let requestedType: CardType | undefined;
            if (typeof payload.cardType === "string") {
              requestedType = payload.cardType as CardType;
            } else if (typeof payload.url === "string" && payload.url.trim()) {
              requestedType = "link";
            }
            const cardId = await createCardForUserHandler(
              ctx,
              userId,
              {
                content:
                  typeof payload.content === "string" ? payload.content : "",
                url: typeof payload.url === "string" ? payload.url : undefined,
                notes:
                  typeof payload.notes === "string" ? payload.notes : undefined,
                tags: Array.isArray(payload.tags)
                  ? payload.tags.filter(
                      (value): value is string => typeof value === "string"
                    )
                  : undefined,
                type: requestedType,
              },
              { source: "api" }
            );

            results.push({
              index,
              status: "success",
              cardId,
            });
            break;
          }
          case "update": {
            const cardId = ctx.db.normalizeId(
              "cards",
              String(payload.cardId ?? "")
            );
            if (!cardId) {
              throw new ConvexError({
                code: "INVALID_INPUT",
                message: "Each update item must include a valid `cardId`",
              });
            }
            const tagError = explainInvalidTags(
              Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (value): value is string => typeof value === "string"
                  )
                : undefined
            );
            if (tagError) {
              throw new ConvexError({
                code: "INVALID_INPUT",
                message: tagError,
              });
            }

            const pipelineDelayMs = await performBulkUpdate(ctx, {
              userId,
              cardId,
              content:
                typeof payload.content === "string"
                  ? payload.content
                  : undefined,
              url: typeof payload.url === "string" ? payload.url : undefined,
              notes:
                payload.notes === null || typeof payload.notes === "string"
                  ? (payload.notes as string | null | undefined)
                  : undefined,
              tags: Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (value): value is string => typeof value === "string"
                  )
                : undefined,
            });
            if (pipelineDelayMs !== null) {
              await queueCardProcessing(ctx, cardId, {
                delayMs: pipelineDelayMs,
                reset: true,
              });
            }

            results.push({
              index,
              status: "success",
              cardId,
            });
            break;
          }
          case "favorite":
          case "delete":
          case "archive":
          case "unarchive":
          case "addTags":
          case "removeTags":
          case "restore": {
            const cardId = ctx.db.normalizeId(
              "cards",
              String(payload.cardId ?? "")
            );
            if (!cardId) {
              throw new ConvexError({
                code: "INVALID_INPUT",
                message: "Each bulk item must include a valid `cardId`",
              });
            }

            let action = args.operation as BulkCardAction;
            if (args.operation === "favorite") {
              assertBulkFavoritePayload(payload);
              action = payload.isFavorited ? "favorite" : "unfavorite";
            }
            const tags =
              action === "addTags" || action === "removeTags"
                ? normalizeBulkTags(
                    Array.isArray(payload.tags)
                      ? payload.tags.filter(
                          (value): value is string => typeof value === "string"
                        )
                      : undefined
                  )
                : undefined;
            await applyCardAction(ctx, { userId, cardId, action, tags });

            results.push({
              index,
              status: "success",
              cardId,
            });
            break;
          }
          default:
            throw new ConvexError({
              code: "INVALID_INPUT",
              message: "Unsupported bulk operation",
            });
        }

        succeeded += 1;
      } catch (error) {
        let message = "Bulk operation failed";
        let code = "INTERNAL_ERROR";
        if (
          error instanceof ConvexError &&
          typeof error.data?.message === "string"
        ) {
          message = error.data.message;
          code =
            typeof error.data.code === "string"
              ? error.data.code
              : "BAD_REQUEST";
        } else if (error instanceof Error) {
          message = error.message;
          if (error instanceof UnsafeUrlError) {
            code = "INVALID_INPUT";
          }
        }

        results.push({
          code,
          index,
          status: "error",
          error: message,
        });
        const failedId =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>).cardId
            : undefined;
        if (typeof failedId === "string" && failedId) {
          failedIds.push(failedId);
        }
      }
    }

    return {
      operation: args.operation,
      results,
      failedIds,
      summary: {
        total: args.items.length,
        succeeded,
        failed: args.items.length - succeeded,
      },
    };
  },
});

export const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

const INVALID_API_AUTH_BUCKET_KEY = "public-api-invalid-auth";

const isRateLimitContentionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('"rateLimits" table') &&
    error.message.includes(
      "changed while this mutation was being run and on every subsequent retry"
    )
  );
};

const toRateLimitResult = (
  result: Awaited<ReturnType<typeof rateLimiter.limit>>
): { ok: boolean; retryAt?: number } => ({
  ok: result.ok,
  retryAt:
    typeof result.retryAfter === "number"
      ? Date.now() + result.retryAfter
      : undefined,
});

// Only a credential's validation mutation mints one, from the identity it
// validated, so a raw bearer token can never key the limiter.
export type ValidatedRateLimitKey = string & {
  readonly __brand: "ValidatedRateLimitKey";
};

export async function limitApiRequests(
  ctx: MutationCtx,
  rateLimitKey: ValidatedRateLimitKey
): Promise<{ ok: boolean; retryAt?: number }> {
  const key = rateLimitKey.trim();
  if (!key) {
    return { ok: false };
  }

  try {
    const result = await rateLimiter.limit(ctx, "publicApiRequests", {
      key,
      throws: false,
    });
    return toRateLimitResult(result);
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return {
        ok: false,
        retryAt: Date.now() + 1000,
      };
    }

    throw error;
  }
}

export const consumeInvalidApiAuthLimit = internalMutation({
  args: {},
  returns: rateLimitResultValidator,
  handler: async (ctx) => {
    try {
      const result = await rateLimiter.limit(ctx, "invalidApiAuth", {
        key: INVALID_API_AUTH_BUCKET_KEY,
        throws: false,
      });
      return toRateLimitResult(result);
    } catch (error) {
      if (isRateLimitContentionError(error)) {
        return {
          ok: false,
          retryAt: Date.now() + 1000,
        };
      }

      throw error;
    }
  },
});
