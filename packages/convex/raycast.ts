import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { createCardForUserHandler } from "./card/createCard";
import { getCardForUserHandler } from "./card/getCard";
import { cardReturnValidator } from "./card/getCards";
import { buildCardListQuery } from "./card/listQuery";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import {
  searchCardsByDocument,
  searchCardsByExactTag,
} from "./card/searchDocumentHelpers";
import {
  type CardFieldEdit,
  updateCardFieldForUserHandler,
  updateCardFieldsForUserHandler,
} from "./card/updateCard";
import { setCardFoldersForUser } from "./folder/membership";
import {
  explainCardTypeMismatch,
  explainInvalidTags,
} from "./publicApiHttpShared";
import {
  type ApiCardSort,
  apiCardSortValidator,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_QUERY_SCAN,
  matchesCreatedAt,
  normalizeCreatedTimestamp,
  normalizeSearchText,
  normalizeSort,
  normalizeTag,
} from "./publicApiSearch";
import { cardTypeValidator } from "./schema";
import { requireTeakUserId, type TeakUserId } from "./securitySessions";

const SEARCH_MULTIPLIER = 4;

const searchArgs = {
  userId: v.string(),
  searchQuery: v.optional(v.string()),
  type: v.optional(cardTypeValidator),
  tag: v.optional(v.string()),
  favoritesOnly: v.optional(v.boolean()),
  createdAfter: v.optional(v.number()),
  createdBefore: v.optional(v.number()),
  sort: v.optional(apiCardSortValidator),
  limit: v.optional(v.number()),
} as const;

const quickSaveResultValidator = v.object({
  status: v.literal("created"),
  cardId: v.id("cards"),
  card: v.optional(cardReturnValidator),
});

const createCardForUserArgs = {
  userId: v.string(),
  cardType: v.optional(cardTypeValidator),
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
  metadataTitle: v.optional(v.union(v.string(), v.null())),
  url: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
  removeAiTags: v.optional(v.array(v.string())),
  isArchived: v.optional(v.boolean()),
  /** Replaces the card's folders; every id must be one of the user's folders. */
  folderIds: v.optional(v.array(v.string())),
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

interface SearchOptions {
  createdAfter?: number;
  createdBefore?: number;
  favoritesOnly?: boolean;
  limit?: number;
  searchQuery?: string;
  sort?: ApiCardSort;
  tag?: string;
  type?: Doc<"cards">["type"];
}

// Unlike the public API's `normalizeLimit`, 0 means the default and an
// infinite limit clamps to the maximum.
const normalizeLimit = (limit?: number): number => {
  if (!limit || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(limit, MAX_LIMIT));
};

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
  sort: ApiCardSort
): number =>
  sort === "oldest"
    ? left.createdAt - right.createdAt
    : right.createdAt - left.createdAt;

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
    const tagSet = new Set(tags.map((tag) => tag.trim().toLowerCase()));
    if (!tagSet.has(options.tag)) {
      return false;
    }
  }

  return true;
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
  userId: TeakUserId,
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

  const unique = (
    await searchCardsByDocument(ctx, {
      userId,
      searchQuery: trimmedQuery,
      isDeleted: undefined,
      isFavorited: options.favoritesOnly ? true : undefined,
      type: options.type,
      limit: searchLimit,
      resultFilter: (card) => matchesStructuredFilters(card, options),
    })
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortAndLimitCards(unique, options);
};

const searchCardsByTag = async (
  ctx: QueryCtx,
  userId: TeakUserId,
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

  const unique = (
    await searchCardsByExactTag(ctx, {
      userId,
      tag: normalizedTag,
      isDeleted: undefined,
      isFavorited: options.favoritesOnly ? true : undefined,
      type: options.type,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      limit: searchLimit,
      sort: normalizeSort(options.sort),
      resultFilter: (card) => matchesStructuredFilters(card, options),
    })
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortAndLimitCards(unique, options);
};

const getCardsForUser = async (
  ctx: QueryCtx,
  userId: TeakUserId,
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
    const baseQuery = buildCardListQuery(ctx, {
      userId,
      favoritesOnly: normalizedOptions.favoritesOnly,
      types: normalizedOptions.type ? [normalizedOptions.type] : undefined,
      createdAt: {
        gte: normalizedOptions.createdAfter,
        lte: normalizedOptions.createdBefore,
      },
    });

    cards = await collectFromBaseQuery(baseQuery, normalizedOptions);
    cards = sortAndLimitCards(cards, normalizedOptions);
  }

  const cardsWithUrls = await attachFileUrls(ctx, cards);
  return applyQuoteFormattingToList(cardsWithUrls);
};

export const quickSaveForUser = internalMutation({
  args: createCardForUserArgs,
  returns: quickSaveResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const submittedContent = args.content;
    const normalizedUrl = args.url?.trim();
    const normalizedNotes =
      typeof args.notes === "string"
        ? args.notes.trim() || undefined
        : undefined;
    const normalizedTags = normalizeTags(args.tags);
    const normalizedSource = args.source?.trim() || undefined;

    const content = submittedContent ?? (normalizedUrl || undefined);
    if (
      content === undefined ||
      (args.cardType !== "text" && !normalizedUrl && !submittedContent?.trim())
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide `content` or `url` to create a card",
      });
    }

    const createError =
      explainInvalidTags(normalizedTags) ??
      explainCardTypeMismatch({
        cardType: args.cardType,
        content: submittedContent,
        notes: normalizedNotes,
        tags: normalizedTags,
      });
    if (createError) {
      throw new ConvexError({ code: "INVALID_INPUT", message: createError });
    }

    const createArgs: Parameters<typeof createCardForUserHandler>[2] = {
      content,
      metadata: normalizedSource ? { source: normalizedSource } : undefined,
      notes: normalizedNotes,
      tags: normalizedTags,
      type: args.cardType ?? (normalizedUrl ? "link" : undefined),
      url: normalizedUrl,
    };

    const cardId = await createCardForUserHandler(ctx, userId, createArgs, {
      source: "raycast",
    });
    const card = await getCardForUserHandler(ctx, userId, cardId);

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
  handler: async (ctx, args) =>
    getCardsForUser(ctx, await requireTeakUserId(ctx, args.userId), {
      createdAfter: args.createdAfter,
      createdBefore: args.createdBefore,
      favoritesOnly: Boolean(args.favoritesOnly),
      limit: args.limit,
      searchQuery: args.searchQuery,
      sort: args.sort,
      tag: args.tag,
      type: args.type,
    }),
});

export const favoriteCardsForUser = internalQuery({
  args: searchArgs,
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) =>
    getCardsForUser(ctx, await requireTeakUserId(ctx, args.userId), {
      createdAfter: args.createdAfter,
      createdBefore: args.createdBefore,
      favoritesOnly: true,
      limit: args.limit,
      searchQuery: args.searchQuery,
      sort: args.sort,
      tag: args.tag,
      type: args.type,
    }),
});

export const resolveCardIdForUserRequest = internalQuery({
  args: {
    cardId: v.string(),
  },
  returns: v.union(v.id("cards"), v.null()),
  handler: (ctx, args) => ctx.db.normalizeId("cards", args.cardId),
});

export const getCardForUser = internalQuery({
  args: cardReferenceArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) =>
    getCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.cardId
    ),
});

export const patchCardForUser = internalMutation({
  args: patchCardForUserArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const edits: CardFieldEdit[] = (args.removeAiTags ?? []).map(
      (tagToRemove) => ({ field: "removeAiTag" as const, tagToRemove })
    );
    if (args.content !== undefined) {
      edits.push({ field: "content", value: args.content });
    }
    if (args.url !== undefined) {
      edits.push({ field: "url", value: args.url });
    }
    if (args.metadataTitle !== undefined) {
      edits.push({ field: "metadataTitle", value: args.metadataTitle });
    }
    if (args.notes !== undefined) {
      edits.push({ field: "notes", value: args.notes });
    }
    if (args.tags !== undefined) {
      edits.push({ field: "tags", value: args.tags });
    }

    if (edits.length > 0) {
      await updateCardFieldsForUserHandler(ctx, {
        userId,
        cardId: args.cardId,
        edits,
      });
    }
    if (args.isArchived !== undefined) {
      await updateCardFieldForUserHandler(ctx, {
        userId,
        cardId: args.cardId,
        field: args.isArchived ? "archive" : "unarchive",
      });
    }
    if (args.folderIds !== undefined) {
      await setCardFoldersForUser(ctx, userId, args.cardId, args.folderIds);
    }

    return getCardForUserHandler(ctx, userId, args.cardId);
  },
});

export const softDeleteCardForUser = internalMutation({
  args: cardReferenceArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    await updateCardFieldForUserHandler(ctx, {
      userId,
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
    const userId = await requireTeakUserId(ctx, args.userId);
    await updateCardFieldForUserHandler(ctx, {
      userId,
      cardId: args.cardId,
      field: "isFavorited",
      value: args.isFavorited,
    });
    return getCardForUserHandler(ctx, userId, args.cardId);
  },
});
