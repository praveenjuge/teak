import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema";
import {
  attachFileUrls,
  ensureValidRange,
  isCreatedAtInRange,
} from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";
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
  thumbnailUrl: v.optional(v.string()),
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

const MIN_SEARCH_BATCH_SIZE = 12;
const PRIMARY_SEARCH_BUFFER = 8;
const SECONDARY_SEARCH_BUFFER = 6;
const TAG_SEARCH_BUFFER = 10;
const VISUAL_SEARCH_BUFFER = 12;

const getSearchBatchLimit = (remainingSlots: number, buffer: number) =>
  Math.max(remainingSlots + buffer, MIN_SEARCH_BATCH_SIZE);

type SearchFieldName =
  | "content"
  | "metadataTitle"
  | "notes"
  | "metadataDescription"
  | "aiSummary"
  | "aiTranscript"
  | "tags"
  | "aiTags";

type SearchIndexName =
  | "search_content"
  | "search_metadata_title"
  | "search_notes"
  | "search_metadata_description"
  | "search_ai_summary"
  | "search_ai_transcript"
  | "search_tags"
  | "search_ai_tags";

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
      // Use compound index by_user_type_deleted to avoid post-index .filter()
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type_deleted", (q) =>
          q
            .eq("userId", user.subject)
            .eq("type", args.type!)
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

    const cards = await query.order("desc").take(args.limit || 50);

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
      limit = 50,
    } = args;
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

      // Search across multiple fields using search indexes
      const searchResults = await Promise.all([
        // Search content
        ctx.db
          .query("cards")
          .withSearchIndex("search_content", (q) =>
            q
              .search("content", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search notes
        ctx.db
          .query("cards")
          .withSearchIndex("search_notes", (q) =>
            q
              .search("notes", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search AI summary
        ctx.db
          .query("cards")
          .withSearchIndex("search_ai_summary", (q) =>
            q
              .search("aiSummary", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search AI transcript
        ctx.db
          .query("cards")
          .withSearchIndex("search_ai_transcript", (q) =>
            q
              .search("aiTranscript", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search metadata title
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_title", (q) =>
            q
              .search("metadataTitle", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search metadata description
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_description", (q) =>
            q
              .search("metadataDescription", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search tags (using JavaScript filter after getting all cards)
        (async () => {
          const allCards = await ctx.db
            .query("cards")
            .withIndex("by_user_deleted", (q) =>
              q
                .eq("userId", user.subject)
                .eq("isDeleted", showTrashOnly ? true : undefined)
            )
            .take(limit * 2); // Get more to filter down

          const searchTerms = searchQuery.toLowerCase().split(/\s+/);
          return allCards.filter((card) =>
            card.tags?.some((tag) =>
              searchTerms.some((term) => tag.toLowerCase().includes(term))
            )
          );
        })(),

        // Search AI tags (using JavaScript filter after getting all cards)
        (async () => {
          const allCards = await ctx.db
            .query("cards")
            .withIndex("by_user_deleted", (q) =>
              q
                .eq("userId", user.subject)
                .eq("isDeleted", showTrashOnly ? true : undefined)
            )
            .take(limit * 2); // Get more to filter down

          const searchTerms = searchQuery.toLowerCase().split(/\s+/);
          return allCards.filter((card) =>
            card.aiTags?.some((tag) =>
              searchTerms.some((term) => tag.toLowerCase().includes(term))
            )
          );
        })(),
      ]);

      // Combine and deduplicate results
      const allResults = searchResults.flat();
      const uniqueResults = Array.from(
        new Map(allResults.map((card) => [card._id, card])).values()
      );

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

export const searchCardsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchQuery: v.optional(v.string()),
    types: v.optional(v.array(cardTypeValidator)),
    favoritesOnly: v.optional(v.boolean()),
    showTrashOnly: v.optional(v.boolean()),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    createdAtRange: v.optional(createdAtRangeValidator),
  },
  returns: paginationResultValidator,
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], isDone: true, continueCursor: null };
    }

    const {
      paginationOpts,
      searchQuery,
      types,
      favoritesOnly,
      showTrashOnly,
      styleFilters,
      hueFilters,
      hexFilters,
      createdAtRange,
    } = args;
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
        const favoritesWithUrls = await attachFileUrls(ctx, filteredFavorites);
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
        const trashedWithUrls = await attachFileUrls(ctx, filteredTrashed);
        return {
          ...trashed,
          page: applyQuoteFormattingToList(trashedWithUrls),
        };
      }

      const rawCursor = paginationOpts.cursor ?? "0";
      const parsedCursor = Number(rawCursor);
      const offset =
        Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
      const pageSize = paginationOpts.numItems;
      const desiredLimit = offset + pageSize + 1;

      // Helper to apply optional filters to search queries
      const applySearchFilters = (q: any) => {
        let query = q
          .eq("userId", user.subject)
          .eq("isDeleted", showTrashOnly ? true : undefined);
        if (types && types.length === 1) {
          query = query.eq("type", types[0]);
        }
        if (favoritesOnly) {
          query = query.eq("isFavorited", true);
        }
        return query;
      };

      // Determine which search indexes to include based on type filter
      // This avoids searching fields that don't exist for certain card types
      const typesSet = new Set(types || []);
      const noTypeFilter = typesSet.size === 0;
      const hasMultiTypeFilter = typesSet.size > 1;
      const includeAiTranscript = noTypeFilter || typesSet.has("audio");
      const includeAiSummary =
        noTypeFilter ||
        (["audio", "video", "document", "image", "link"] as const).some((t) =>
          typesSet.has(t)
        );

      // Build search query array, ordered by selectivity (most selective first)
      // 1. content - most unique user content
      // 2. metadataTitle - usually selective
      // 3. notes - user-written
      // 4. metadataDescription - less selective
      // 5. aiSummary - less selective, only for certain types
      // 6. aiTranscript - only for audio type
      // 7. tags - small value set, less selective
      // 8. aiTags - small value set, less selective
      const buildSearchQuery = (
        indexName: SearchIndexName,
        fieldName: SearchFieldName
      ) => {
        return (limit: number) =>
          ctx.db
            .query("cards")
            .withSearchIndex(indexName, (q) =>
              applySearchFilters(q).search(fieldName, searchQuery)
            )
            .take(limit);
      };

      const buildPrimaryBatch = (limit: number) => [
        buildSearchQuery("search_content", "content")(limit),
        buildSearchQuery("search_metadata_title", "metadataTitle")(limit),
        buildSearchQuery("search_notes", "notes")(limit),
      ];

      const buildSecondaryBatch = (limit: number) => [
        buildSearchQuery(
          "search_metadata_description",
          "metadataDescription"
        )(limit),
        ...(includeAiSummary
          ? [buildSearchQuery("search_ai_summary", "aiSummary")(limit)]
          : []),
        ...(includeAiTranscript
          ? [buildSearchQuery("search_ai_transcript", "aiTranscript")(limit)]
          : []),
      ];

      const buildTagBatch = (limit: number) => [
        buildSearchQuery("search_tags", "tags")(limit),
        buildSearchQuery("search_ai_tags", "aiTags")(limit),
      ];

      const queryBatches: (() => Promise<Doc<"cards">[]>[])[] = [
        () =>
          buildPrimaryBatch(
            getSearchBatchLimit(
              desiredLimit - uniqueResults.length,
              PRIMARY_SEARCH_BUFFER
            )
          ),
        () =>
          buildSecondaryBatch(
            getSearchBatchLimit(
              desiredLimit - uniqueResults.length,
              SECONDARY_SEARCH_BUFFER
            )
          ),
        () =>
          buildTagBatch(
            getSearchBatchLimit(
              desiredLimit - uniqueResults.length,
              TAG_SEARCH_BUFFER
            )
          ),
      ];

      // Incrementally deduplicate with early termination
      // This avoids running less-selective queries when enough results are found.
      const seenIds = new Set<string>();
      const uniqueResults: Doc<"cards">[] = [];

      for (const getBatch of queryBatches) {
        const batchResults = await Promise.all(getBatch());
        for (const results of batchResults) {
          for (const card of results) {
            if (seenIds.has(card._id)) continue;
            seenIds.add(card._id);
            if (!isCreatedAtInRange(card.createdAt, createdAtRange)) continue;
            if (hasMultiTypeFilter && !typesSet.has(card.type)) continue;
            if (!doesCardMatchVisualFilters(card, visualFilters)) continue;
            uniqueResults.push(card);
            if (uniqueResults.length >= desiredLimit) break;
          }
          if (uniqueResults.length >= desiredLimit) break;
        }
        if (uniqueResults.length >= desiredLimit) break;
      }

      // Multi-type filtering happens during dedupe; single-type/favorites are filtered at index level.
      const filteredResults = uniqueResults;

      const sortedResults = filteredResults.sort(
        (a, b) => b.createdAt - a.createdAt
      );
      const page = sortedResults.slice(offset, offset + pageSize);
      const isDone = sortedResults.length <= offset + pageSize;
      const continueCursor = isDone ? null : String(offset + pageSize);

      const pageWithUrls = await attachFileUrls(ctx, page);
      return {
        page: applyQuoteFormattingToList(pageWithUrls),
        isDone,
        continueCursor,
      };
    }

    if (visualFilters.hasVisualFilters) {
      const rawCursor = paginationOpts.cursor ?? "0";
      const parsedCursor = Number(rawCursor);
      const offset =
        Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
      const pageSize = paginationOpts.numItems;
      const desiredLimit = offset + pageSize + 1;

      const visualResults = await runVisualFacetQueries(ctx, {
        userId: user.subject,
        showTrashOnly,
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
        limit: getSearchBatchLimit(desiredLimit, VISUAL_SEARCH_BUFFER),
      });

      const page = visualResults.slice(offset, offset + pageSize);
      const isDone = visualResults.length <= offset + pageSize;
      const continueCursor = isDone ? null : String(offset + pageSize);
      const pageWithUrls = await attachFileUrls(ctx, page);

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

      const cards = await query.order("desc").paginate(paginationOpts);
      const cardsWithUrls = await attachFileUrls(ctx, cards.page);
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
    const cardsWithUrls = await attachFileUrls(ctx, cards.page);
    return {
      ...cards,
      page: applyQuoteFormattingToList(cardsWithUrls),
    };
  },
});
