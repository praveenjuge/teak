import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema";
import { applyQuoteFormattingToList } from "./quoteFormatting";

// Return validator for card arrays - includes _id and _creationTime from Convex
export const cardReturnValidator = v.object({
  ...cardValidator.fields,
  _id: v.id("cards"),
  _creationTime: v.number(),
  fileUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
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

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

const attachFileUrls = async (
  ctx: any,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  // Collect all unique storage IDs across all cards
  const storageIds = new Set<string>();
  const cardToIds = new Map<
    string,
    {
      fileId?: string;
      thumbnailId?: string;
      screenshotId?: string;
      linkPreviewImageId?: string;
    }
  >();

  for (const card of cards) {
    const ids: Record<string, string | undefined> = {};
    if (card.fileId) {
      storageIds.add(card.fileId);
      ids.fileId = card.fileId;
    }
    if (card.thumbnailId) {
      storageIds.add(card.thumbnailId);
      ids.thumbnailId = card.thumbnailId;
    }
    if (card.metadata?.linkPreview?.imageStorageId) {
      storageIds.add(card.metadata.linkPreview.imageStorageId);
      ids.linkPreviewImageId = card.metadata.linkPreview.imageStorageId;
    }
    if (card.metadata?.linkPreview?.screenshotStorageId) {
      storageIds.add(card.metadata.linkPreview.screenshotStorageId);
      ids.screenshotId = card.metadata.linkPreview.screenshotStorageId;
    }
    cardToIds.set(card._id, ids);
  }

  // Fetch all URLs in parallel
  const urlPromises = Array.from(storageIds).map(async (id) => ({
    id,
    url: await ctx.storage.getUrl(id as any),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((r) => [r.id, r.url]));

  // Map URLs back to cards
  return cards.map((card) => {
    const ids = cardToIds.get(card._id) || {};
    return {
      ...card,
      fileUrl: ids.fileId ? (urlMap.get(ids.fileId) ?? undefined) : undefined,
      thumbnailUrl: ids.thumbnailId
        ? (urlMap.get(ids.thumbnailId) ?? undefined)
        : undefined,
      screenshotUrl: ids.screenshotId
        ? (urlMap.get(ids.screenshotId) ?? undefined)
        : undefined,
      linkPreviewImageUrl: ids.linkPreviewImageId
        ? (urlMap.get(ids.linkPreviewImageId) ?? undefined)
        : undefined,
    };
  });
};

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
      limit = 50,
    } = args;

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
        const favoritesWithUrls = await attachFileUrls(ctx, favorites);
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
        const trashedWithUrls = await attachFileUrls(ctx, trashed);
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
      let filteredResults = uniqueResults;

      if (types && types.length > 0) {
        filteredResults = filteredResults.filter((card) =>
          types.includes(card.type)
        );
      }

      if (favoritesOnly) {
        filteredResults = filteredResults.filter(
          (card) => card.isFavorited === true
        );
      }

      // Sort by creation date (desc) and limit
      const limitedResults = filteredResults
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      const resultsWithUrls = await attachFileUrls(ctx, limitedResults);
      return applyQuoteFormattingToList(resultsWithUrls);
    }

    // No search query - use regular indexes with filters
    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q
          .eq("userId", user.subject)
          .eq("isDeleted", showTrashOnly ? true : undefined)
      );

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
  },
  returns: paginationResultValidator,
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], isDone: true, continueCursor: null };
    }

    const { paginationOpts, searchQuery, types, favoritesOnly, showTrashOnly } =
      args;

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
        const favoritesWithUrls = await attachFileUrls(ctx, favorites.page);
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
        const trashedWithUrls = await attachFileUrls(ctx, trashed.page);
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
      // Reduced multipliers - with <1000 cards per user, aggressive over-fetch isn't needed
      const searchLimit = Math.max(desiredLimit + 20, pageSize);
      const tagSearchLimit = Math.max(searchLimit + 20, searchLimit + 1);

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
      const searchQueries = [
        ctx.db
          .query("cards")
          .withSearchIndex("search_content", (q) =>
            applySearchFilters(q).search("content", searchQuery)
          )
          .take(searchLimit),
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_title", (q) =>
            applySearchFilters(q).search("metadataTitle", searchQuery)
          )
          .take(searchLimit),
        ctx.db
          .query("cards")
          .withSearchIndex("search_notes", (q) =>
            applySearchFilters(q).search("notes", searchQuery)
          )
          .take(searchLimit),
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_description", (q) =>
            applySearchFilters(q).search("metadataDescription", searchQuery)
          )
          .take(searchLimit),
        ...(includeAiSummary
          ? [
              ctx.db
                .query("cards")
                .withSearchIndex("search_ai_summary", (q) =>
                  applySearchFilters(q).search("aiSummary", searchQuery)
                )
                .take(searchLimit),
            ]
          : []),
        ...(includeAiTranscript
          ? [
              ctx.db
                .query("cards")
                .withSearchIndex("search_ai_transcript", (q) =>
                  applySearchFilters(q).search("aiTranscript", searchQuery)
                )
                .take(searchLimit),
            ]
          : []),
        ctx.db
          .query("cards")
          .withSearchIndex("search_tags", (q) =>
            applySearchFilters(q).search("tags", searchQuery)
          )
          .take(tagSearchLimit),
        ctx.db
          .query("cards")
          .withSearchIndex("search_ai_tags", (q) =>
            applySearchFilters(q).search("aiTags", searchQuery)
          )
          .take(tagSearchLimit),
      ];

      const searchResults = await Promise.all(searchQueries);

      // Incrementally deduplicate with early termination
      // This is more efficient than collecting all results then deduplicating
      const seenIds = new Set<string>();
      const uniqueResults: Doc<"cards">[] = [];

      for (const results of searchResults) {
        for (const card of results) {
          if (seenIds.has(card._id)) continue;
          seenIds.add(card._id);
          if (hasMultiTypeFilter && !typesSet.has(card.type)) continue;
          uniqueResults.push(card);
          // Early termination if we have enough results
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

    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q
          .eq("userId", user.subject)
          .eq("isDeleted", showTrashOnly ? true : undefined)
      );

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
