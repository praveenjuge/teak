import type { PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
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
import { cardTypes, cardTypeValidator } from "./schema";
import { requireTeakUserId, type TeakUserId } from "./securitySessions";
import { rateLimiter } from "./shared/rateLimits";
import { matchesSearchPhrases } from "./shared/search/qualifiers";
import {
  isShuffleSeed,
  shuffleBySeed,
  shuffleRank,
} from "./shared/search/shuffle";
import { isSafeExternalUrl, UnsafeUrlError } from "./shared/utils/safeUrl";

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
  /** Archived cards outside Trash; defaults to `"exclude"`. */
  archived?: ArchivedFilter;
  /** In Trash, only the cards that were archived (`is:archived`). */
  archivedInTrash?: boolean;
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  /** Only cards in this folder; the caller checked it is the user's. */
  folderId?: Id<"folders">;
  /** Folders a card must also be in (`folder:`), already resolved. */
  folderIds?: Id<"folders">[];
  hexFilters?: string[];
  hueFilters?: string[];
  limit?: number;
  /** Quoted phrases a card's text must contain. */
  phrases?: string[];
  searchQuery?: string;
  showTrashOnly?: boolean;
  /** Normalized hosts (`site:`); a card on any of them matches. */
  sites?: string[];
  sort?: ApiCardSort;
  styleFilters?: string[];
  tag?: string;
  /** More tags a card must carry besides `tag`. */
  tags?: string[];
  type?: Doc<"cards">["type"];
  types?: Doc<"cards">["type"][];
}

// A card's position in list order: createdAt for date-filtered listings,
// _creationTime for the others.
interface ListAnchor {
  createdAt: number;
  creationTime: number;
}

// Search and tag pages resume strictly after the last card they returned.
interface MatchAnchor {
  createdAt: number;
  id: string;
}

type ApiCursor =
  | { mode: "start" }
  // Keyset cursors: stable when cards are added or removed between pages.
  | { mode: "list"; anchor?: ListAnchor; page?: string }
  | { mode: "match"; anchor: MatchAnchor }
  // Cursors issued before keyset paging. Still accepted so a client that is
  // mid-pagination during a deploy can finish.
  | { mode: "index"; cursor: string | null; pageOffset: number }
  | { mode: "offset"; offset: number };

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
  // The card's search document text, when the caller read it: it holds the
  // card's extracted text too, which quoted phrases also match.
  searchableText?: string
): boolean => {
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

// True when `card` sorts strictly after `anchor` in the requested order.
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

// Full-text pages are cut from one fixed candidate set: the first
// MAX_QUERY_SCAN matches by relevance, sorted by creation date. Every page
// reads the same set, so pages never overlap or skip, whatever the page size,
// and the last page ends the search cleanly.
const SEARCH_CANDIDATE_LIMIT = MAX_QUERY_SCAN;

const searchCardsByQuery = async (
  ctx: QueryCtx,
  userId: TeakUserId,
  options: SearchOptions
): Promise<{ cards: Doc<"cards">[]; hitScanBudget: boolean }> => {
  const searchQuery = normalizeSearchText(options.searchQuery);
  if (!searchQuery) {
    return { cards: [], hitScanBudget: false };
  }

  const typeGroups = options.types ?? [options.type];
  const scanBudget = { remaining: 4096, hitSearchLimit: false };
  const found: Doc<"cards">[][] = [];
  for (const type of typeGroups) {
    found.push(
      await searchCardsByDocument(ctx, {
        userId,
        searchQuery,
        isDeleted: options.showTrashOnly ? true : undefined,
        archived: options.archived,
        isFavorited: options.favorited,
        type,
        urlHost: options.sites?.length === 1 ? options.sites[0] : undefined,
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

  return {
    cards: sortCards(unique, normalizeSort(options.sort)).slice(
      0,
      MAX_QUERY_SCAN
    ),
    hitScanBudget: scanBudget.hitSearchLimit,
  };
};

/**
 * Reads the tag page after `anchor`. Tag rows are read in (createdAt, card id)
 * order, the same order compareCards uses, so each type group only needs the
 * first `limit + 1` matches after the anchor.
 */
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

/**
 * Builds the listing query, ordered by `createdAt` (ties by insertion order).
 * With an anchor, the range starts at the anchor's position so a page resumes
 * right after the last card returned, even when cards were added or removed
 * in between. The anchor bound is inclusive; cards that share its createdAt
 * and come before it are skipped while reading (see isAtOrBeforeListAnchor).
 */
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
  // One site reads its host index; the scan filters everything else.
  const host = options.sites?.length === 1 ? options.sites[0] : undefined;
  if (host && !options.showTrashOnly && options.archived !== "include") {
    return buildHostCardListQuery(ctx, {
      userId,
      host,
      archived: options.archived === "only" ? "only" : "exclude",
      createdAt: { gte: lower, lte: upper },
    });
  }
  return buildCardListQuery(ctx, {
    userId,
    trash: options.showTrashOnly,
    archived: options.archived,
    favoritesOnly: options.favorited === true,
    types: options.type ? [options.type] : options.types,
    createdAt: { gte: lower, lte: upper },
  });
};

// In createdAt order, cards sharing the anchor's createdAt are ordered by
// _creationTime; those up to and including the anchor were already served.
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

/**
 * A folder listing: the folder's rows in `createdAt` order, resuming after
 * the anchor row like createBaseQuery does for the library. Anchors carry
 * the row's own creation time, which orders rows that share a date.
 */
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
    // Folder cursors are always keyset cursors this listing issued.
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
    sites: args.sites?.length ? args.sites : undefined,
    tags: tags.length ? tags : undefined,
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
    /** Qualifiers from `q` (shared/search/qualifiers.ts), merged in. */
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    limit: v.optional(v.number()),
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
    const options = normalizeCardsQueryOptions({ ...args, folderIds });
    const limit = normalizeLimit(options.limit);
    const sort = normalizeSort(options.sort);
    const decodedCursor = decodeCursor(args.cursor);
    if (decodedCursor.mode === "list" || decodedCursor.mode === "index") {
      throw invalidCursorError();
    }
    const anchor =
      decodedCursor.mode === "match" ? decodedCursor.anchor : undefined;
    let pageItems: Doc<"cards">[];
    let hasMore: boolean;

    if (options.searchQuery) {
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
      // A cursor this search issued always gets its page; only a first page
      // that ran out of read budget before finding enough is "too broad".
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

// Shuffle cursors carry the seed they belong to: a walk position through
// the library, or the last card of a shuffled set of matches.
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
  // A cursor from another seed or sort would skip or repeat cards.
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

// After the anchor in seeded order: by rank, then by id.
const isAfterShuffleAnchor = (
  seed: number,
  id: string,
  anchor: { rank: number; id: string }
) => {
  const rank = shuffleRank(seed, id);
  return rank > anchor.rank || (rank === anchor.rank && id > anchor.id);
};

/** Tag or folder rows a shuffled listing puts in order (the newest). */
const SHUFFLE_SET_ROWS = 2000;
/** Cards one shuffled tag or folder page loads at most. */
const SHUFFLE_SET_LOADS = MAX_QUERY_SCAN;
/** Rows one shuffled library page reads at most. */
const SHUFFLE_WALK_SCAN = MAX_QUERY_SCAN;

/**
 * `sort=shuffle`: a stable random order for `shuffleSeed`. A search, a tag
 * or a folder puts its matches in the seed's order (a search keeps its
 * best MAX_QUERY_SCAN matches, a tag or folder its newest); the library
 * walks every card by its random key. A page can come back short with
 * more to read; the HTTP handler reads on until the page is full.
 */
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
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    limit: v.optional(v.number()),
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
    const options = normalizeCardsQueryOptions({
      ...args,
      folderIds,
      sort: "newest",
    });
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

    // A set of matches: put it in the seed's order and resume after the
    // last card served.
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

    // A tag's or folder's rows: their card ids in the seed's order, loading
    // only the cards a page needs (at most SHUFFLE_SET_LOADS, so a page can
    // come back short). The cursor resumes after the last card examined.
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

    if (options.searchQuery) {
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

    // The library: walk it by each card's random key.
    if (cursor.mode === "after") {
      throw invalidCursorError();
    }
    const walk = {
      userId,
      seed,
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
    /** Qualifiers from `q` (shared/search/qualifiers.ts), merged in. */
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
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
    // A `folder:` name drives the read like `folder=` when that is unset.
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

// Most tag-index rows one tag listing reads.
const MAX_TAG_ROWS_READ = 8000;
// Most distinct tags one listing counts. Each is two index lookups, and a
// function may only make so many, so a vault of many small tags stops here
// (GET /v1/tags then answers from the background tag summary).
const MAX_TAGS_READ = 500;

/**
 * Lists the tags on cards outside Trash and Archive, with how many cards
 * carry each,
 * from the per-tag search index rather than the cards. Tags are the
 * lowercase names `GET /v1/cards?tag=` matches, including tags Teak added.
 * Reads at most MAX_TAG_ROWS_READ index rows and MAX_TAGS_READ tags;
 * `isComplete` is false when a very large vault hits either bound.
 */
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
        // Stop before another lookup; more tags may follow.
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
      // Seek to the next distinct tag name.
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

// Changes cursors walk changed cards first, then permanently deleted ones.
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

    // Cards are done: fill the rest of the page with permanent deletions.
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

// Validates every field before writing and charges the reprocess limit once,
// so a rejected item leaves its card untouched.
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

  if (type && !cardTypes.includes(type as (typeof cardTypes)[number])) {
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
            let requestedType: (typeof cardTypes)[number] | undefined;
            if (typeof payload.cardType === "string") {
              requestedType = payload.cardType as (typeof cardTypes)[number];
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
              await ctx.scheduler.runAfter(
                pipelineDelayMs,
                (internal as any)["workflows/manager"]
                  .startCardProcessingWorkflow,
                {
                  cardId,
                }
              );
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

// Public API rate limits. Both answer { ok, retryAt } instead of throwing so
// the HTTP layer can map a limit or table contention to its own response.
export const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

// Single shared bucket key for all failed public-API auth attempts. Keeping it
// constant (rather than per-token) means rotating bearer tokens can no longer
// spawn fresh rate-limit documents, so invalid auth is bounded globally.
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

// Charges one public API request to a validated identity. Called inside the
// credential's own validation mutation. Never pass a raw bearer token as the
// key: rotating tokens would otherwise mint a fresh bucket per request.
export async function limitApiRequests(
  ctx: MutationCtx,
  rateLimitKey: string
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

// Consumes one token from the shared invalid-auth bucket. Called only when a
// public-API request presents a well-formed but unrecognized API key, so that
// repeated invalid attempts are throttled globally instead of per token.
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
