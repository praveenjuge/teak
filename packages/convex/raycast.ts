import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { createCardForUserHandler } from "./card/createCard";
import { findDuplicateCardForUserHandler } from "./card/findDuplicateCard";
import { cardReturnValidator } from "./card/getCards";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const quickSaveResultValidator = v.object({
  status: v.union(v.literal("created"), v.literal("duplicate")),
  cardId: v.id("cards"),
});

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeLimit = (limit?: number): number => {
  if (!limit || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(limit, MAX_LIMIT));
};

const applySearchFilters = (
  query: any,
  userId: string,
  favoritesOnly: boolean
) => {
  const filteredQuery = query.eq("userId", userId).eq("isDeleted", undefined);
  return favoritesOnly ? filteredQuery.eq("isFavorited", true) : filteredQuery;
};

const getCardsForUser = async (
  ctx: QueryCtx,
  userId: string,
  {
    searchQuery,
    favoritesOnly,
    limit,
  }: {
    searchQuery?: string;
    favoritesOnly?: boolean;
    limit?: number;
  }
) => {
  const normalizedLimit = normalizeLimit(limit);
  const trimmedQuery = searchQuery?.trim();

  if (!trimmedQuery) {
    const baseQuery = favoritesOnly
      ? ctx.db
          .query("cards")
          .withIndex("by_user_favorites_deleted", (q) =>
            q
              .eq("userId", userId)
              .eq("isFavorited", true)
              .eq("isDeleted", undefined)
          )
      : ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) =>
            q.eq("userId", userId).eq("isDeleted", undefined)
          );

    const cards = await baseQuery.order("desc").take(normalizedLimit);
    const cardsWithUrls = await attachFileUrls(ctx, cards);
    return applyQuoteFormattingToList(cardsWithUrls);
  }

  const searchResults = await Promise.all([
    ctx.db
      .query("cards")
      .withSearchIndex("search_content", (q) =>
        applySearchFilters(
          q.search("content", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_notes", (q) =>
        applySearchFilters(
          q.search("notes", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_ai_summary", (q) =>
        applySearchFilters(
          q.search("aiSummary", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_ai_transcript", (q) =>
        applySearchFilters(
          q.search("aiTranscript", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_metadata_title", (q) =>
        applySearchFilters(
          q.search("metadataTitle", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_metadata_description", (q) =>
        applySearchFilters(
          q.search("metadataDescription", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_tags", (q) =>
        applySearchFilters(
          q.search("tags", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_ai_tags", (q) =>
        applySearchFilters(
          q.search("aiTags", trimmedQuery),
          userId,
          Boolean(favoritesOnly)
        )
      )
      .take(normalizedLimit),
  ]);

  const allResults = searchResults.flat();
  const unique = Array.from(
    new Map(allResults.map((card) => [card._id, card])).values()
  )
    .filter((card) => !favoritesOnly || card.isFavorited)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, normalizedLimit);

  const cardsWithUrls = await attachFileUrls(ctx, unique);
  return applyQuoteFormattingToList(cardsWithUrls);
};

export const quickSaveForUser = internalMutation({
  args: {
    userId: v.string(),
    content: v.string(),
  },
  returns: quickSaveResultValidator,
  handler: async (ctx, args) => {
    const content = args.content.trim();
    if (!content) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Content cannot be empty",
      });
    }

    if (isHttpUrl(content)) {
      const duplicate = await findDuplicateCardForUserHandler(
        ctx,
        args.userId,
        content
      );
      if (duplicate) {
        return {
          status: "duplicate" as const,
          cardId: duplicate._id as Id<"cards">,
        };
      }

      const cardId = await createCardForUserHandler(ctx, args.userId, {
        content,
        type: "link",
        url: content,
      });
      return { status: "created" as const, cardId };
    }

    const cardId = await createCardForUserHandler(ctx, args.userId, {
      content,
      type: "text",
    });
    return { status: "created" as const, cardId };
  },
});

export const searchCardsForUser = internalQuery({
  args: {
    userId: v.string(),
    searchQuery: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardsForUser(ctx, args.userId, {
      searchQuery: args.searchQuery,
      favoritesOnly: false,
      limit: args.limit,
    });
  },
});

export const favoriteCardsForUser = internalQuery({
  args: {
    userId: v.string(),
    searchQuery: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardsForUser(ctx, args.userId, {
      searchQuery: args.searchQuery,
      favoritesOnly: true,
      limit: args.limit,
    });
  },
});
