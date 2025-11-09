import { v } from "convex/values";
import { query } from "../../_generated/server";
import { cardTypeValidator } from "../../schema";
import { applyQuoteFormattingToList } from "./quoteFormatting";

export const getCards = query({
  args: {
    type: v.optional(cardTypeValidator),
    favoritesOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
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
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", user.subject).eq("type", args.type!)
        )
        .filter((q) => q.neq(q.field("isDeleted"), true));
    }

    if (args.favoritesOnly) {
      query = ctx.db
        .query("cards")
        .withIndex("by_user_favorites", (q) =>
          q.eq("userId", user.subject).eq("isFavorited", true)
        )
        .filter((q) => q.neq(q.field("isDeleted"), true));
    }

    const cards = await query.order("desc").take(args.limit || 50);

    return applyQuoteFormattingToList(cards);
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
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      // Handle special keywords
      if (["fav", "favs", "favorites", "favourite", "favourites"].includes(query)) {
        const favorites = await ctx.db
          .query("cards")
          .withIndex("by_user_favorites", (q) =>
            q.eq("userId", user.subject).eq("isFavorited", true)
          )
          .filter((q) => q.neq(q.field("isDeleted"), true))
          .order("desc")
          .take(limit);
        return applyQuoteFormattingToList(favorites);
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        const trashed = await ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) =>
            q.eq("userId", user.subject).eq("isDeleted", true)
          )
          .order("desc")
          .take(limit);
        return applyQuoteFormattingToList(trashed);
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
      ]);

      // Combine and deduplicate results
      const allResults = searchResults.flat();
      const uniqueResults = Array.from(
        new Map(allResults.map(card => [card._id, card])).values()
      );

      // Apply additional filters
      let filteredResults = uniqueResults;

      if (types && types.length > 0) {
        filteredResults = filteredResults.filter(card => types.includes(card.type));
      }

      if (favoritesOnly) {
        filteredResults = filteredResults.filter(card => card.isFavorited === true);
      }

      // Sort by creation date (desc) and limit
      const limitedResults = filteredResults
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      return applyQuoteFormattingToList(limitedResults);
    }

    // No search query - use regular indexes with filters
    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", showTrashOnly ? true : undefined)
      );

    if (types && types.length === 1) {
      // Optimize for single type filter
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", user.subject).eq("type", types[0])
        )
        .filter((q) =>
          showTrashOnly
            ? q.eq(q.field("isDeleted"), true)
            : q.neq(q.field("isDeleted"), true)
        );
    } else if (types && types.length > 1) {
      // Filter by multiple types
      query = query.filter((q) => {
        const typeConditions = types.map(type => q.eq(q.field("type"), type));
        return typeConditions.reduce((acc, condition) => q.or(acc, condition));
      });
    }

    if (favoritesOnly) {
      query = query.filter((q) => q.eq(q.field("isFavorited"), true));
    }

    const cards = await query.order("desc").take(limit);
    return applyQuoteFormattingToList(cards);
  },
});
