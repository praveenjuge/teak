import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { createCardForUserHandler } from "./card/createCard";
import { getCardForUserHandler } from "./card/getCard";
import { cardReturnValidator } from "./card/getCards";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import { updateCardFieldForUserHandler } from "./card/updateCard";
import { cardTypeValidator } from "./schema";
import { rateLimiter } from "./shared/rateLimits";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SEARCH_MULTIPLIER = 4;
const MAX_QUERY_SCAN = 400;

const sortValidator = v.union(v.literal("newest"), v.literal("oldest"));
type RaycastSort = "newest" | "oldest";

const searchArgs = {
  userId: v.string(),
  searchQuery: v.optional(v.string()),
  type: v.optional(cardTypeValidator),
  tag: v.optional(v.string()),
  favoritesOnly: v.optional(v.boolean()),
  createdAfter: v.optional(v.number()),
  createdBefore: v.optional(v.number()),
  sort: v.optional(sortValidator),
  limit: v.optional(v.number()),
} as const;

const quickSaveResultValidator = v.object({
  status: v.literal("created"),
  cardId: v.id("cards"),
  card: v.optional(cardReturnValidator),
});

const raycastRateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

const createCardForUserArgs = {
  userId: v.string(),
  content: v.optional(v.string()),
  url: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
  source: v.optional(v.string()),
} as const;

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

type SearchOptions = {
  createdAfter?: number;
  createdBefore?: number;
  favoritesOnly?: boolean;
  limit?: number;
  searchQuery?: string;
  sort?: RaycastSort;
  tag?: string;
  type?: Doc<"cards">["type"];
};

const SEARCH_INDEXES = [
  { field: "content", index: "search_content" },
  { field: "notes", index: "search_notes" },
  { field: "aiSummary", index: "search_ai_summary" },
  { field: "aiTranscript", index: "search_ai_transcript" },
  { field: "metadataTitle", index: "search_metadata_title" },
  { field: "metadataDescription", index: "search_metadata_description" },
  { field: "tags", index: "search_tags" },
  { field: "aiTags", index: "search_ai_tags" },
] as const;

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
  const pepper = process.env.AUTH_SECRET_PEPPER ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${value}:${pepper}`)
  );
  return toHex(new Uint8Array(digest));
};

const normalizeLimit = (limit?: number): number => {
  if (!limit || Number.isNaN(limit)) {
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

const normalizeCreatedTimestamp = (value?: number): number | undefined => {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }

  return value;
};

const normalizeSort = (value?: RaycastSort): RaycastSort =>
  value === "oldest" ? "oldest" : "newest";

const normalizeTags = (tags?: string[]): string[] | undefined => {
  if (!Array.isArray(tags)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  );

  return normalized.length > 0 ? normalized : undefined;
};

const compareCards = (
  left: Pick<Doc<"cards">, "createdAt">,
  right: Pick<Doc<"cards">, "createdAt">,
  sort: RaycastSort
): number => {
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
  options: SearchOptions
): boolean => {
  if (options.type && card.type !== options.type) {
    return false;
  }

  if (options.favoritesOnly && card.isFavorited !== true) {
    return false;
  }

  if (!matchesCreatedAt(card.createdAt, options)) {
    return false;
  }

  if (options.tag) {
    const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])];
    const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
    if (!tagSet.has(options.tag)) {
      return false;
    }
  }

  return true;
};

const applySearchIndexFilters = (
  query: any,
  userId: string,
  options: SearchOptions
) => {
  let filteredQuery = query.eq("userId", userId).eq("isDeleted", undefined);

  if (options.type) {
    filteredQuery = filteredQuery.eq("type", options.type);
  }

  if (options.favoritesOnly) {
    filteredQuery = filteredQuery.eq("isFavorited", true);
  }

  return filteredQuery;
};

const sortAndLimitCards = (
  cards: Doc<"cards">[],
  options: SearchOptions
): Doc<"cards">[] => {
  const sort = normalizeSort(options.sort);
  const limit = normalizeLimit(options.limit);
  return cards
    .sort((left, right) => compareCards(left, right, sort))
    .slice(0, limit);
};

const collectFromBaseQuery = async (
  baseQuery: any,
  options: SearchOptions
): Promise<Doc<"cards">[]> => {
  const sort = normalizeSort(options.sort);
  const limit = normalizeLimit(options.limit);
  const pageSize = Math.min(Math.max(limit * 2, 50), 100);
  const matches: Doc<"cards">[] = [];
  let cursor: string | null = null;
  let scanned = 0;

  while (matches.length < limit && scanned < MAX_QUERY_SCAN) {
    const page: {
      continueCursor: string | null;
      isDone: boolean;
      page: Doc<"cards">[];
    } = await baseQuery.order(sort === "oldest" ? "asc" : "desc").paginate({
      cursor,
      numItems: pageSize,
    });

    for (const card of page.page as Doc<"cards">[]) {
      scanned += 1;
      if (matchesStructuredFilters(card, options)) {
        matches.push(card);
        if (matches.length >= limit) {
          break;
        }
      }
    }

    if (page.isDone || !page.continueCursor) {
      break;
    }

    cursor = page.continueCursor;
  }

  return matches;
};

const searchCardsByQuery = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions
): Promise<Doc<"cards">[]> => {
  const trimmedQuery = normalizeSearchText(options.searchQuery);
  if (!trimmedQuery) {
    return [];
  }

  const searchLimit = Math.max(
    normalizeLimit(options.limit) * SEARCH_MULTIPLIER,
    normalizeLimit(options.limit) + 20
  );

  const searchResults = await Promise.all(
    SEARCH_INDEXES.map(({ field, index }) =>
      ctx.db
        .query("cards")
        .withSearchIndex(index, (query: any) =>
          applySearchIndexFilters(query, userId, options).search(
            field,
            trimmedQuery
          )
        )
        .take(searchLimit)
    )
  );

  const unique = Array.from(
    new Map(searchResults.flat().map((card) => [card._id, card])).values()
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortAndLimitCards(unique, options);
};

const searchCardsByTag = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions
): Promise<Doc<"cards">[]> => {
  const normalizedTag = normalizeTag(options.tag);
  if (!normalizedTag) {
    return [];
  }

  const searchLimit = Math.max(
    normalizeLimit(options.limit) * SEARCH_MULTIPLIER,
    normalizeLimit(options.limit) + 20
  );

  const searchResults = await Promise.all([
    ctx.db
      .query("cards")
      .withSearchIndex("search_tags", (query: any) =>
        applySearchIndexFilters(query, userId, options).search(
          "tags",
          normalizedTag
        )
      )
      .take(searchLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_ai_tags", (query: any) =>
        applySearchIndexFilters(query, userId, options).search(
          "aiTags",
          normalizedTag
        )
      )
      .take(searchLimit),
  ]);

  const unique = Array.from(
    new Map(searchResults.flat().map((card) => [card._id, card])).values()
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortAndLimitCards(unique, options);
};

const getCardsForUser = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions
) => {
  const normalizedOptions: SearchOptions = {
    ...options,
    createdAfter: normalizeCreatedTimestamp(options.createdAfter),
    createdBefore: normalizeCreatedTimestamp(options.createdBefore),
    favoritesOnly: Boolean(options.favoritesOnly),
    limit: normalizeLimit(options.limit),
    searchQuery: normalizeSearchText(options.searchQuery),
    sort: normalizeSort(options.sort),
    tag: normalizeTag(options.tag),
  };

  if (
    normalizedOptions.createdAfter !== undefined &&
    normalizedOptions.createdBefore !== undefined &&
    normalizedOptions.createdAfter > normalizedOptions.createdBefore
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "`createdAfter` must be less than or equal to `createdBefore`",
    });
  }

  let cards: Doc<"cards">[];

  if (normalizedOptions.searchQuery) {
    cards = await searchCardsByQuery(ctx, userId, normalizedOptions);
  } else if (normalizedOptions.tag) {
    cards = await searchCardsByTag(ctx, userId, normalizedOptions);
  } else {
    let baseQuery = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (query) =>
        query.eq("userId", userId).eq("isDeleted", undefined)
      );

    if (
      normalizedOptions.type &&
      !normalizedOptions.favoritesOnly &&
      normalizedOptions.createdAfter === undefined &&
      normalizedOptions.createdBefore === undefined
    ) {
      baseQuery = ctx.db
        .query("cards")
        .withIndex("by_user_type_deleted", (query) =>
          query
            .eq("userId", userId)
            .eq("type", normalizedOptions.type!)
            .eq("isDeleted", undefined)
        );
    } else if (
      normalizedOptions.favoritesOnly &&
      normalizedOptions.createdAfter === undefined &&
      normalizedOptions.createdBefore === undefined
    ) {
      baseQuery = ctx.db
        .query("cards")
        .withIndex("by_user_favorites_deleted", (query) =>
          query
            .eq("userId", userId)
            .eq("isFavorited", true)
            .eq("isDeleted", undefined)
        );
    } else if (
      normalizedOptions.createdAfter !== undefined ||
      normalizedOptions.createdBefore !== undefined
    ) {
      baseQuery = ctx.db.query("cards").withIndex("by_created", (query) => {
        if (
          normalizedOptions.createdAfter !== undefined &&
          normalizedOptions.createdBefore !== undefined
        ) {
          return query
            .eq("userId", userId)
            .gte("createdAt", normalizedOptions.createdAfter)
            .lt("createdAt", normalizedOptions.createdBefore + 1);
        }

        if (normalizedOptions.createdAfter !== undefined) {
          return query
            .eq("userId", userId)
            .gte("createdAt", normalizedOptions.createdAfter);
        }

        if (normalizedOptions.createdBefore !== undefined) {
          return query
            .eq("userId", userId)
            .lt("createdAt", normalizedOptions.createdBefore + 1);
        }

        return query.eq("userId", userId);
      });
    }

    cards = await collectFromBaseQuery(baseQuery, normalizedOptions);
    cards = sortAndLimitCards(cards, normalizedOptions);
  }

  const cardsWithUrls = await attachFileUrls(ctx, cards);
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
  args: createCardForUserArgs,
  returns: quickSaveResultValidator,
  handler: async (ctx, args) => {
    const normalizedContent = args.content?.trim();
    const normalizedUrl = args.url?.trim();
    const normalizedNotes =
      typeof args.notes === "string"
        ? args.notes.trim() || undefined
        : undefined;
    const normalizedTags = normalizeTags(args.tags);
    const normalizedSource = args.source?.trim() || undefined;

    if (!(normalizedContent || normalizedUrl)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide `content` or `url` to create a card",
      });
    }

    const createArgs: Parameters<typeof createCardForUserHandler>[2] = {
      content: normalizedContent ?? normalizedUrl!,
      metadata: normalizedSource ? { source: normalizedSource } : undefined,
      notes: normalizedNotes,
      tags: normalizedTags,
      type: normalizedUrl ? "link" : undefined,
      url: normalizedUrl,
    };

    const cardId = await createCardForUserHandler(ctx, args.userId, createArgs);
    const card = await getCardForUserHandler(ctx, args.userId, cardId);

    return {
      status: "created" as const,
      card: card ?? undefined,
      cardId,
    };
  },
});

export const searchCardsForUser = internalQuery({
  args: searchArgs,
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardsForUser(ctx, args.userId, {
      createdAfter: args.createdAfter,
      createdBefore: args.createdBefore,
      favoritesOnly: Boolean(args.favoritesOnly),
      limit: args.limit,
      searchQuery: args.searchQuery,
      sort: args.sort,
      tag: args.tag,
      type: args.type,
    });
  },
});

export const favoriteCardsForUser = internalQuery({
  args: searchArgs,
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardsForUser(ctx, args.userId, {
      createdAfter: args.createdAfter,
      createdBefore: args.createdBefore,
      favoritesOnly: true,
      limit: args.limit,
      searchQuery: args.searchQuery,
      sort: args.sort,
      tag: args.tag,
      type: args.type,
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

export const getCardForUser = internalQuery({
  args: cardReferenceArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardForUserHandler(ctx, args.userId, args.cardId);
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
            (
              await applyPatchField(ctx, {
                userId: args.userId,
                cardId: args.cardId,
                field,
                value: args.content,
              })
            ).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "url":
          shouldSchedulePipeline =
            (
              await applyPatchField(ctx, {
                userId: args.userId,
                cardId: args.cardId,
                field,
                value: args.url,
              })
            ).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "notes":
          shouldSchedulePipeline =
            (
              await applyPatchField(ctx, {
                userId: args.userId,
                cardId: args.cardId,
                field,
                value: args.notes,
              })
            ).shouldSchedulePipeline || shouldSchedulePipeline;
          break;
        case "tags":
          shouldSchedulePipeline =
            (
              await applyPatchField(ctx, {
                userId: args.userId,
                cardId: args.cardId,
                field,
                value: args.tags,
              })
            ).shouldSchedulePipeline || shouldSchedulePipeline;
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
