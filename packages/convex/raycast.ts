import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { createCardForUserHandler } from "./card/createCard";
import { findDuplicateCardForUserHandler } from "./card/findDuplicateCard";
import { getCardForUserHandler } from "./card/getCard";
import { cardReturnValidator } from "./card/getCards";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import { updateCardFieldForUserHandler } from "./card/updateCard";
import { rateLimiter } from "./shared/rateLimits";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const quickSaveResultValidator = v.object({
  status: v.union(v.literal("created"), v.literal("duplicate")),
  cardId: v.id("cards"),
});

const raycastRateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

const patchCardForUserArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
  content: v.optional(v.string()),
  url: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
} as const;

const setCardFavoriteForUserArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
  isFavorited: v.boolean(),
} as const;

const cardReferenceArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
} as const;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

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

const hashRateLimitKey = async (value: string): Promise<string> => {
  const pepper = process.env.BETTER_AUTH_SECRET ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${value}:${pepper}`)
  );
  return toHex(new Uint8Array(digest));
};

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

const applyPatchField = async (
  ctx: MutationCtx,
  args: {
    userId: string;
    cardId: Id<"cards">;
    field: "content" | "url" | "notes" | "tags";
    value?: unknown;
  }
) => {
  return updateCardFieldForUserHandler(
    ctx,
    {
      userId: args.userId,
      cardId: args.cardId,
      field: args.field,
      value: args.value,
    },
    { deferPipelineSchedule: true }
  );
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

export const resolveCardIdForUserRequest = internalQuery({
  args: {
    cardId: v.string(),
  },
  returns: v.union(v.id("cards"), v.null()),
  handler: async (ctx, args) => {
    return ctx.db.normalizeId("cards", args.cardId);
  },
});

export const patchCardForUser = internalMutation({
  args: patchCardForUserArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    const requestedFields: Array<"content" | "url" | "notes" | "tags"> = [];
    let shouldSchedulePipeline = false;

    if (args.content !== undefined) {
      requestedFields.push("content");
    }
    if (args.url !== undefined) {
      requestedFields.push("url");
    }
    if (args.notes !== undefined) {
      requestedFields.push("notes");
    }
    if (args.tags !== undefined) {
      requestedFields.push("tags");
    }

    if (requestedFields.length === 0) {
      return getCardForUserHandler(ctx, args.userId, args.cardId);
    }

    for (const field of requestedFields) {
      switch (field) {
        case "content":
          shouldSchedulePipeline =
            (await applyPatchField(ctx, {
              userId: args.userId,
              cardId: args.cardId,
              field,
              value: args.content,
            })).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "url":
          shouldSchedulePipeline =
            (await applyPatchField(ctx, {
              userId: args.userId,
              cardId: args.cardId,
              field,
              value: args.url,
            })).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "notes":
          shouldSchedulePipeline =
            (await applyPatchField(ctx, {
              userId: args.userId,
              cardId: args.cardId,
              field,
              value: args.notes,
            })).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "tags":
          shouldSchedulePipeline =
            (await applyPatchField(ctx, {
              userId: args.userId,
              cardId: args.cardId,
              field,
              value: args.tags,
            })).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        default:
          throw new Error(`Unsupported field: ${field}`);
      }
    }

    if (shouldSchedulePipeline) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/manager"].startCardProcessingWorkflow,
        {
          cardId: args.cardId,
        }
      );
    }

    return getCardForUserHandler(ctx, args.userId, args.cardId);
  },
});

export const softDeleteCardForUser = internalMutation({
  args: cardReferenceArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateCardFieldForUserHandler(ctx, {
      userId: args.userId,
      cardId: args.cardId,
      field: "delete",
    });
    return null;
  },
});

export const setCardFavoriteForUser = internalMutation({
  args: setCardFavoriteForUserArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    await updateCardFieldForUserHandler(ctx, {
      userId: args.userId,
      cardId: args.cardId,
      field: "isFavorited",
      value: args.isFavorited,
    });
    return getCardForUserHandler(ctx, args.userId, args.cardId);
  },
});

export const checkApiRateLimit = internalMutation({
  args: {
    token: v.string(),
  },
  returns: raycastRateLimitResultValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) {
      return { ok: false };
    }

    const key = await hashRateLimitKey(token);
    let result: Awaited<ReturnType<typeof rateLimiter.limit>>;
    try {
      result = await rateLimiter.limit(ctx, "raycastApiRequests", {
        key,
        throws: false,
      });
    } catch (error) {
      if (isRateLimitContentionError(error)) {
        return {
          ok: false,
          retryAt: Date.now() + 1000,
        };
      }

      throw error;
    }

    return {
      ok: result.ok,
      retryAt:
        typeof result.retryAfter === "number"
          ? Date.now() + result.retryAfter
          : undefined,
    };
  },
});
