import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema";
import { getSessionUser } from "../securitySessions";
import {
  clampPageSize,
  clampSearchLimit,
  clampSearchOffset,
} from "../shared/search/constants";
import {
  type ArchivedFilter,
  buildCardListQuery,
  buildFolderCardListQuery,
  type CardListSort,
  cardListSortValidator,
  compareCardsByCreatedAt,
  normalizeCardListSort,
} from "./listQuery";
import {
  attachCardSummaryUrls,
  attachFileUrls,
  attachGridFileUrls,
  ensureValidRange,
  isCreatedAtInRange,
} from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";
import { searchCardsByDocument } from "./searchDocumentHelpers";
import {
  applyCardLevelFilters,
  doesCardMatchVisualFilters,
  normalizeVisualFilterArgs,
  runVisualFacetQueries,
} from "./visualFilters";

// Return validator for card arrays - includes _id and _creationTime from Convex
export const cardReturnValidator = v.object({
  ...cardValidator.fields,
  _id: v.id("cards"),
  _creationTime: v.number(),
  fileUrl: v.optional(v.string()),
  detailUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  compactUrl: v.optional(v.string()),
  placeholderUrl: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
  scrubUrl: v.optional(v.string()),
  linkPreviewMedia: v.optional(
    v.array(
      v.object({
        type: v.union(v.literal("image"), v.literal("video")),
        url: v.string(),
        contentType: v.optional(v.string()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        posterUrl: v.optional(v.string()),
        posterContentType: v.optional(v.string()),
        posterWidth: v.optional(v.number()),
        posterHeight: v.optional(v.number()),
      })
    )
  ),
  linkPreviewImageUrl: v.optional(v.string()),
});

const paginationResultValidator = v.object({
  page: v.array(cardReturnValidator),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())
  ),
});

const createdAtRangeValidator = v.object({
  start: v.number(),
  end: v.number(),
});

const VISUAL_SEARCH_BUFFER = 12;
// Paginated search pages are cut from this many best matches, sorted by date.
const SEARCH_PAGE_CANDIDATE_LIMIT = 401;

const isSearchTooBroadError = (error: unknown): boolean =>
  error instanceof ConvexError &&
  (error.data as { code?: unknown } | undefined)?.code === "INVALID_INPUT";
export const getSearchResultLimit = (desiredLimit: number) =>
  Math.max(1, desiredLimit);
const getVisualSearchBatchLimit = (desiredLimit: number) =>
  Math.max(desiredLimit + VISUAL_SEARCH_BUFFER, 12);
/**
 * Most folder rows a color, style or favorites view of one folder reads; a
 * larger folder is filtered within its newest (or oldest) cards.
 */
const FOLDER_FILTER_SCAN_LIMIT = 1000;

export const getCards = query({
  args: {
    type: v.optional(cardTypeValidator),
    favoritesOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }

    const query = buildCardListQuery(ctx, {
      userId: user.teakUserId,
      favoritesOnly: args.favoritesOnly,
      types: args.type ? [args.type] : undefined,
    });

    const cards = await query.order("desc").take(clampSearchLimit(args.limit));

    const cardsWithUrls = await attachFileUrls(ctx, cards);
    return applyQuoteFormattingToList(cardsWithUrls);
  },
});

// New server-side search and filter query
export const searchCards = query({
  args: {
    searchQuery: v.optional(v.string()),
    types: v.optional(v.array(cardTypeValidator)),
    favoritesOnly: v.optional(v.boolean()),
    showTrashOnly: v.optional(v.boolean()),
    showArchivedOnly: v.optional(v.boolean()),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    createdAtRange: v.optional(createdAtRangeValidator),
    limit: v.optional(v.number()),
    sort: v.optional(cardListSortValidator),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }

    const {
      searchQuery,
      types,
      favoritesOnly,
      showTrashOnly,
      styleFilters,
      hueFilters,
      hexFilters,
      createdAtRange,
    } = args;
    const archived: ArchivedFilter = args.showArchivedOnly ? "only" : "exclude";
    const limit = clampSearchLimit(args.limit);
    const sort = normalizeCardListSort(args.sort);
    const order = sort === "oldest" ? "asc" : "desc";
    ensureValidRange(createdAtRange);
    const visualFilters = normalizeVisualFilterArgs({
      styleFilters,
      hueFilters,
      hexFilters,
    });

    // If we have a search query, use search indexes for efficiency
    if (searchQuery?.trim()) {
      const query = searchQuery.toLowerCase().trim();

      // Handle special keywords
      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        const favorites = await buildCardListQuery(ctx, {
          userId: user.teakUserId,
          favoritesOnly: true,
        })
          .order(order)
          .take(limit);
        const filteredFavorites = applyCardLevelFilters(favorites, {
          types,
          favoritesOnly: true,
          createdAtRange,
          visualFilters,
        }).slice(0, limit);
        const favoritesWithUrls = await attachFileUrls(ctx, filteredFavorites);
        return applyQuoteFormattingToList(favoritesWithUrls);
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        const trashed = await buildCardListQuery(ctx, {
          userId: user.teakUserId,
          trash: true,
        })
          .order(order)
          .take(limit);
        const filteredTrashed = applyCardLevelFilters(trashed, {
          types,
          favoritesOnly,
          createdAtRange,
          visualFilters,
        }).slice(0, limit);
        const trashedWithUrls = await attachFileUrls(ctx, filteredTrashed);
        return applyQuoteFormattingToList(trashedWithUrls);
      }

      const uniqueResults = await searchCardsByDocument(ctx, {
        userId: user.teakUserId,
        searchQuery,
        isDeleted: showTrashOnly ? true : undefined,
        archived,
        isFavorited: favoritesOnly ? true : undefined,
        type: types?.length === 1 ? types[0] : undefined,
        limit: getSearchResultLimit(limit),
        resultFilter: (card) =>
          applyCardLevelFilters([card], {
            types,
            favoritesOnly,
            createdAtRange,
            visualFilters,
          }).length === 1,
      });

      // Apply additional filters
      const filteredResults = applyCardLevelFilters(uniqueResults, {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });

      const limitedResults = filteredResults
        .sort((a, b) => compareCardsByCreatedAt(a, b, sort))
        .slice(0, limit);

      const resultsWithUrls = await attachFileUrls(ctx, limitedResults);
      return applyQuoteFormattingToList(resultsWithUrls);
    }

    // No search query - use visual facet indexes when requested.
    if (visualFilters.hasVisualFilters) {
      const visualResults = await runVisualFacetQueries(ctx, {
        userId: user.teakUserId,
        showTrashOnly,
        archived,
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
        limit: Math.max(limit * 3, limit + 40),
        sort,
      });
      const limitedVisualResults = visualResults.slice(0, limit);
      const visualResultsWithUrls = await attachFileUrls(
        ctx,
        limitedVisualResults
      );
      return applyQuoteFormattingToList(visualResultsWithUrls);
    }

    const cards = await buildCardListQuery(ctx, {
      userId: user.teakUserId,
      trash: showTrashOnly,
      archived,
      favoritesOnly,
      types,
      createdAt: createdAtRange
        ? { gte: createdAtRange.start, lt: createdAtRange.end }
        : undefined,
    })
      .order(order)
      .take(limit);
    const cardsWithUrls = await attachFileUrls(ctx, cards);
    return applyQuoteFormattingToList(cardsWithUrls);
  },
});

export const searchCardsPaginatedArgsValidator = v.object({
  paginationOpts: paginationOptsValidator,
  searchQuery: v.optional(v.string()),
  types: v.optional(v.array(cardTypeValidator)),
  favoritesOnly: v.optional(v.boolean()),
  showTrashOnly: v.optional(v.boolean()),
  /** The Archive view: archived cards that are not in Trash. */
  showArchivedOnly: v.optional(v.boolean()),
  styleFilters: v.optional(v.array(v.string())),
  hueFilters: v.optional(v.array(v.string())),
  hexFilters: v.optional(v.array(v.string())),
  createdAtRange: v.optional(createdAtRangeValidator),
  sort: v.optional(cardListSortValidator),
  /** Only cards in this folder (the folder view). */
  folderId: v.optional(v.id("folders")),
});

type SearchCardsPaginatedArgs = Infer<typeof searchCardsPaginatedArgsValidator>;

export const searchCardsPaginatedHandler = async (
  ctx: QueryCtx,
  args: SearchCardsPaginatedArgs,
  options: { gridOnly?: boolean; summariesOnly?: boolean } = {}
) => {
  let attachListUrls = attachFileUrls;
  if (options.summariesOnly) {
    attachListUrls = attachCardSummaryUrls;
  } else if (options.gridOnly) {
    attachListUrls = attachGridFileUrls;
  }
  const user = await getSessionUser(ctx);
  if (!user) {
    return { page: [], isDone: true, continueCursor: null };
  }

  const {
    paginationOpts: rawPaginationOpts,
    searchQuery,
    types,
    favoritesOnly,
    showTrashOnly,
    styleFilters,
    hueFilters,
    hexFilters,
    createdAtRange,
  } = args;
  const archived: ArchivedFilter = args.showArchivedOnly ? "only" : "exclude";
  const sort: CardListSort = normalizeCardListSort(args.sort);
  const order = sort === "oldest" ? "asc" : "desc";
  // A folder view lists only that folder's cards. A folder that is missing,
  // being deleted or another user's lists nothing.
  const folderId = args.folderId;
  if (folderId) {
    const folder = await ctx.db.get("folders", folderId);
    if (
      !folder ||
      folder.userId !== user.teakUserId ||
      folder.deletingAt !== undefined
    ) {
      return { page: [], isDone: true, continueCursor: null };
    }
  }
  const inFolder = (card: Doc<"cards">) =>
    !folderId || (card.folderIds ?? []).includes(folderId);
  // Clamp the caller-provided page size so a single request cannot force an
  // arbitrarily large index read / in-memory sort. The cursor is validated
  // separately where it is parsed into an offset.
  const paginationOpts = {
    ...rawPaginationOpts,
    numItems: clampPageSize(rawPaginationOpts.numItems),
  };
  ensureValidRange(createdAtRange);
  const visualFilters = normalizeVisualFilterArgs({
    styleFilters,
    hueFilters,
    hexFilters,
  });

  if (searchQuery?.trim()) {
    const query = searchQuery.toLowerCase().trim();

    // The quick commands list the whole library, so inside a folder the
    // words are searched like any other.
    if (
      !folderId &&
      ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
    ) {
      const favorites = await buildCardListQuery(ctx, {
        userId: user.teakUserId,
        favoritesOnly: true,
      })
        .order(order)
        .paginate(paginationOpts);
      const filteredFavorites = applyCardLevelFilters(favorites.page, {
        types,
        favoritesOnly: true,
        createdAtRange,
        visualFilters,
      });
      const favoritesWithUrls = await attachListUrls(ctx, filteredFavorites);
      return {
        ...favorites,
        page: applyQuoteFormattingToList(favoritesWithUrls),
      };
    }

    if (
      !folderId &&
      ["trash", "deleted", "bin", "recycle", "trashed"].includes(query)
    ) {
      const trashed = await buildCardListQuery(ctx, {
        userId: user.teakUserId,
        trash: true,
      })
        .order(order)
        .paginate(paginationOpts);
      const filteredTrashed = applyCardLevelFilters(trashed.page, {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });
      const trashedWithUrls = await attachListUrls(ctx, filteredTrashed);
      return {
        ...trashed,
        page: applyQuoteFormattingToList(trashedWithUrls),
      };
    }

    const rawCursor = paginationOpts.cursor ?? "0";
    const parsedCursor = Number(rawCursor);
    const offset = clampSearchOffset(
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0
    );
    const pageSize = clampPageSize(paginationOpts.numItems);

    const typesSet = new Set(types || []);
    const hasMultiTypeFilter = typesSet.size > 1;
    const matchesFilters = (card: Doc<"cards">) =>
      inFolder(card) &&
      isCreatedAtInRange(card.createdAt, createdAtRange) &&
      (!hasMultiTypeFilter || typesSet.has(card.type)) &&
      doesCardMatchVisualFilters(card, visualFilters);
    const searchArgs = {
      userId: user.teakUserId,
      searchQuery,
      isDeleted: showTrashOnly ? true : undefined,
      archived,
      isFavorited: favoritesOnly ? true : undefined,
      type: types?.length === 1 ? types[0] : undefined,
      limit: SEARCH_PAGE_CANDIDATE_LIMIT,
    };
    // Every page sorts the same candidate set, so offsets never overlap or
    // skip between pages.
    let searchResults: Doc<"cards">[];
    try {
      searchResults = await searchCardsByDocument(ctx, {
        ...searchArgs,
        resultFilter: matchesFilters,
      });
    } catch (error) {
      if (!isSearchTooBroadError(error)) {
        throw error;
      }
      // A saturated search with selective filters: filter the best matches
      // instead of failing the grid.
      searchResults = await searchCardsByDocument(ctx, searchArgs);
    }
    const uniqueResults = searchResults.filter(matchesFilters);

    // Multi-type filtering happens during dedupe; single-type/favorites are filtered at index level.
    const filteredResults = uniqueResults;

    const sortedResults = filteredResults.sort((a, b) =>
      compareCardsByCreatedAt(a, b, sort)
    );
    const page = sortedResults.slice(offset, offset + pageSize);
    const isDone = sortedResults.length <= offset + pageSize;
    const continueCursor = isDone ? null : String(offset + pageSize);

    const pageWithUrls = await attachListUrls(ctx, page);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone,
      continueCursor,
    };
  }

  // Colors, styles and favorites inside a folder: the library-wide search
  // indexes can't narrow to one folder, so read the folder's own rows (in
  // date order) and filter them here.
  if (folderId && (visualFilters.hasVisualFilters || favoritesOnly)) {
    const rawCursor = paginationOpts.cursor ?? "0";
    const parsedCursor = Number(rawCursor);
    const offset = clampSearchOffset(
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0
    );
    const pageSize = clampPageSize(paginationOpts.numItems);
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      trash: showTrashOnly,
      archived,
      types,
      createdAt: createdAtRange
        ? { gte: createdAtRange.start, lt: createdAtRange.end }
        : undefined,
    })
      .order(order)
      .take(FOLDER_FILTER_SCAN_LIMIT);
    const cards: Doc<"cards">[] = [];
    for (const row of rows) {
      const card = await ctx.db.get("cards", row.cardId);
      if (card) {
        cards.push(card);
      }
    }
    const matches = applyCardLevelFilters(cards, {
      types,
      favoritesOnly,
      createdAtRange,
      visualFilters,
    });
    const page = matches.slice(offset, offset + pageSize);
    const isDone = matches.length <= offset + pageSize;
    const pageWithUrls = await attachListUrls(ctx, page);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone,
      continueCursor: isDone ? null : String(offset + pageSize),
    };
  }

  if (visualFilters.hasVisualFilters) {
    const rawCursor = paginationOpts.cursor ?? "0";
    const parsedCursor = Number(rawCursor);
    const offset = clampSearchOffset(
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0
    );
    const pageSize = clampPageSize(paginationOpts.numItems);
    const desiredLimit = offset + pageSize + 1;

    const visualResults = await runVisualFacetQueries(ctx, {
      userId: user.teakUserId,
      showTrashOnly,
      archived,
      types,
      favoritesOnly,
      createdAtRange,
      visualFilters,
      limit: getVisualSearchBatchLimit(desiredLimit),
      sort,
    });

    const page = visualResults.slice(offset, offset + pageSize);
    const isDone = visualResults.length <= offset + pageSize;
    const continueCursor = isDone ? null : String(offset + pageSize);
    const pageWithUrls = await attachListUrls(ctx, page);

    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone,
      continueCursor,
    };
  }

  if (folderId) {
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      trash: showTrashOnly,
      archived,
      types,
      createdAt: createdAtRange
        ? { gte: createdAtRange.start, lt: createdAtRange.end }
        : undefined,
    })
      .order(order)
      .paginate(paginationOpts);
    const folderCards: Doc<"cards">[] = [];
    for (const row of rows.page) {
      const card = await ctx.db.get("cards", row.cardId);
      if (card) {
        folderCards.push(card);
      }
    }
    const folderCardsWithUrls = await attachListUrls(ctx, folderCards);
    return {
      ...rows,
      page: applyQuoteFormattingToList(folderCardsWithUrls),
    };
  }

  const cards = await buildCardListQuery(ctx, {
    userId: user.teakUserId,
    trash: showTrashOnly,
    archived,
    favoritesOnly,
    types,
    createdAt: createdAtRange
      ? { gte: createdAtRange.start, lt: createdAtRange.end }
      : undefined,
  })
    .order(order)
    .paginate(paginationOpts);
  const cardsWithUrls = await attachListUrls(ctx, cards.page);
  return {
    ...cards,
    page: applyQuoteFormattingToList(cardsWithUrls),
  };
};

export const searchCardsPaginated = query({
  args: searchCardsPaginatedArgsValidator.fields,
  returns: paginationResultValidator,
  handler: (ctx, args) =>
    searchCardsPaginatedHandler(ctx, args, { gridOnly: true }),
});
