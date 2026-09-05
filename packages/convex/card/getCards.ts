import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema";
import {
  clampPageSize,
  clampSearchLimit,
  clampSearchOffset,
} from "../shared/search/constants";
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
export const getSearchResultLimit = (desiredLimit: number) =>
  Math.max(1, desiredLimit);
const getVisualSearchBatchLimit = (desiredLimit: number) =>
  Math.max(desiredLimit + VISUAL_SEARCH_BUFFER, 12);

export const getCards = query({
  args: {
    type: v.optional(cardTypeValidator),
    favoritesOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      );

    if (args.type) {
      const cardType = args.type;
      // Use compound index by_user_type_deleted to avoid post-index .filter()
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type_deleted", (q) =>
          q
            .eq("userId", user.subject)
            .eq("type", cardType)
            .eq("isDeleted", undefined)
        );
    }

    if (args.favoritesOnly) {
      // Use compound index by_user_favorites_deleted to avoid post-index .filter()
      query = ctx.db
        .query("cards")
        .withIndex("by_user_favorites_deleted", (q) =>
          q
            .eq("userId", user.subject)
            .eq("isFavorited", true)
            .eq("isDeleted", undefined)
        );
    }

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
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    createdAtRange: v.optional(createdAtRangeValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
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
    const limit = clampSearchLimit(args.limit);
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
        // Use compound index by_user_favorites_deleted to avoid post-index .filter()
        const favorites = await ctx.db
          .query("cards")
          .withIndex("by_user_favorites_deleted", (q) =>
            q
              .eq("userId", user.subject)
              .eq("isFavorited", true)
              .eq("isDeleted", undefined)
          )
          .order("desc")
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
        const trashed = await ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) =>
            q.eq("userId", user.subject).eq("isDeleted", true)
          )
          .order("desc")
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
        userId: user.subject,
        searchQuery,
        isDeleted: showTrashOnly ? true : undefined,
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

      // Sort by creation date (desc) and limit
      const limitedResults = filteredResults
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      const resultsWithUrls = await attachFileUrls(ctx, limitedResults);
      return applyQuoteFormattingToList(resultsWithUrls);
    }

    // No search query - use visual facet indexes when requested.
    if (visualFilters.hasVisualFilters) {
      const visualResults = await runVisualFacetQueries(ctx, {
        userId: user.subject,
        showTrashOnly,
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
        limit: Math.max(limit * 3, limit + 40),
      });
      const limitedVisualResults = visualResults.slice(0, limit);
      const visualResultsWithUrls = await attachFileUrls(
        ctx,
        limitedVisualResults
      );
      return applyQuoteFormattingToList(visualResultsWithUrls);
    }

    // No search query - use regular indexes with filters
    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q
          .eq("userId", user.subject)
          .eq("isDeleted", showTrashOnly ? true : undefined)
      );

    if (createdAtRange) {
      query = ctx.db
        .query("cards")
        .withIndex("by_created", (q) =>
          q
            .eq("userId", user.subject)
            .gte("createdAt", createdAtRange.start)
            .lt("createdAt", createdAtRange.end)
        );

      query = query.filter((q) =>
        q.eq(q.field("isDeleted"), showTrashOnly ? true : undefined)
      );

      if (types && types.length > 0) {
        query = query.filter((q) => {
          const typeConditions = types.map((type) =>
            q.eq(q.field("type"), type)
          );
          return typeConditions.reduce((acc, condition) =>
            q.or(acc, condition)
          );
        });
      }

      if (favoritesOnly) {
        query = query.filter((q) => q.eq(q.field("isFavorited"), true));
      }

      const cards = await query.order("desc").take(limit);
      const cardsWithUrls = await attachFileUrls(ctx, cards);
      return applyQuoteFormattingToList(cardsWithUrls);
    }

    if (types && types.length === 1) {
      // Use compound index by_user_type_deleted to avoid post-index .filter()
      query = ctx.db.query("cards").withIndex("by_user_type_deleted", (q) =>
        q
          .eq("userId", user.subject)
          .eq("type", types[0])
          .eq("isDeleted", showTrashOnly ? true : undefined)
      );
    } else if (types && types.length > 1) {
      // Filter by multiple types - must use .filter() for OR conditions across different type values
      query = query.filter((q) => {
        const typeConditions = types.map((type) => q.eq(q.field("type"), type));
        return typeConditions.reduce((acc, condition) => q.or(acc, condition));
      });
    }

    if (favoritesOnly) {
      // When filtering by favorites on top of existing query, we still need .filter()
      // because we can't use a different index mid-query
      query = query.filter((q) => q.eq(q.field("isFavorited"), true));
    }

    const cards = await query.order("desc").take(limit);
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
  styleFilters: v.optional(v.array(v.string())),
  hueFilters: v.optional(v.array(v.string())),
  hexFilters: v.optional(v.array(v.string())),
  createdAtRange: v.optional(createdAtRangeValidator),
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
  const user = await ctx.auth.getUserIdentity();
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

    if (
      ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
    ) {
      const favorites = await ctx.db
        .query("cards")
        .withIndex("by_user_favorites_deleted", (q) =>
          q
            .eq("userId", user.subject)
            .eq("isFavorited", true)
            .eq("isDeleted", undefined)
        )
        .order("desc")
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

    if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
      const trashed = await ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) =>
          q.eq("userId", user.subject).eq("isDeleted", true)
        )
        .order("desc")
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
    const desiredLimit = offset + pageSize + 1;
    const searchResultLimit = getSearchResultLimit(desiredLimit);

    const typesSet = new Set(types || []);
    const hasMultiTypeFilter = typesSet.size > 1;
    const searchResults = await searchCardsByDocument(ctx, {
      userId: user.subject,
      searchQuery,
      isDeleted: showTrashOnly ? true : undefined,
      isFavorited: favoritesOnly ? true : undefined,
      type: types?.length === 1 ? types[0] : undefined,
      limit: searchResultLimit,
      resultFilter: (card) =>
        isCreatedAtInRange(card.createdAt, createdAtRange) &&
        (!hasMultiTypeFilter || typesSet.has(card.type)) &&
        doesCardMatchVisualFilters(card, visualFilters),
    });
    const uniqueResults: Doc<"cards">[] = [];
    for (const card of searchResults) {
      if (
        isCreatedAtInRange(card.createdAt, createdAtRange) &&
        (!hasMultiTypeFilter || typesSet.has(card.type)) &&
        doesCardMatchVisualFilters(card, visualFilters)
      ) {
        uniqueResults.push(card);
      }
    }

    // Multi-type filtering happens during dedupe; single-type/favorites are filtered at index level.
    const filteredResults = uniqueResults;

    const sortedResults = filteredResults.sort(
      (a, b) => b.createdAt - a.createdAt
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

  if (visualFilters.hasVisualFilters) {
    const rawCursor = paginationOpts.cursor ?? "0";
    const parsedCursor = Number(rawCursor);
    const offset = clampSearchOffset(
      Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0
    );
    const pageSize = clampPageSize(paginationOpts.numItems);
    const desiredLimit = offset + pageSize + 1;

    const visualResults = await runVisualFacetQueries(ctx, {
      userId: user.subject,
      showTrashOnly,
      types,
      favoritesOnly,
      createdAtRange,
      visualFilters,
      limit: getVisualSearchBatchLimit(desiredLimit),
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

  let query = ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q
        .eq("userId", user.subject)
        .eq("isDeleted", showTrashOnly ? true : undefined)
    );

  if (createdAtRange) {
    query = ctx.db
      .query("cards")
      .withIndex("by_created", (q) =>
        q
          .eq("userId", user.subject)
          .gte("createdAt", createdAtRange.start)
          .lt("createdAt", createdAtRange.end)
      );

    query = query.filter((q) =>
      q.eq(q.field("isDeleted"), showTrashOnly ? true : undefined)
    );

    if (types && types.length > 0) {
      query = query.filter((q) => {
        const typeConditions = types.map((type) => q.eq(q.field("type"), type));
        return typeConditions.reduce((acc, condition) => q.or(acc, condition));
      });
    }

    if (favoritesOnly) {
      query = query.filter((q) => q.eq(q.field("isFavorited"), true));
    }

    const cards = await query.order("desc").paginate(paginationOpts);
    const cardsWithUrls = await attachListUrls(ctx, cards.page);
    return {
      ...cards,
      page: applyQuoteFormattingToList(cardsWithUrls),
    };
  }

  if (types && types.length === 1) {
    query = ctx.db.query("cards").withIndex("by_user_type_deleted", (q) =>
      q
        .eq("userId", user.subject)
        .eq("type", types[0])
        .eq("isDeleted", showTrashOnly ? true : undefined)
    );
  } else if (types && types.length > 1) {
    query = query.filter((q) => {
      const typeConditions = types.map((type) => q.eq(q.field("type"), type));
      return typeConditions.reduce((acc, condition) => q.or(acc, condition));
    });
  }

  if (favoritesOnly) {
    query = query.filter((q) => q.eq(q.field("isFavorited"), true));
  }

  const cards = await query.order("desc").paginate(paginationOpts);
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
