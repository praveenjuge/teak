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
import { cardReturnValidator } from "./card/getCards";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import { updateCardFieldForUserHandler } from "./card/updateCard";
import { cardTypeValidator } from "./schema";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SEARCH_MULTIPLIER = 4;
const MAX_QUERY_SCAN = 400;

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
    v.literal("delete")
  ),
  results: v.array(v.any()),
  summary: v.object({
    total: v.number(),
    succeeded: v.number(),
    failed: v.number(),
  }),
});

type SearchOptions = {
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  limit?: number;
  searchQuery?: string;
  sort?: ApiCardSort;
  tag?: string;
  type?: Doc<"cards">["type"];
};

type ApiCursor =
  | { mode: "index"; cursor: string | null; pageOffset: number }
  | { mode: "offset"; offset: number };

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
    return undefined;
  }

  return value;
};

const compareCards = (
  left: Pick<Doc<"cards">, "createdAt" | "_id">,
  right: Pick<Doc<"cards">, "createdAt" | "_id">,
  sort: ApiCardSort
): number => {
  if (left.createdAt === right.createdAt) {
    return sort === "oldest"
      ? String(left._id).localeCompare(String(right._id))
      : String(right._id).localeCompare(String(left._id));
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
  options: SearchOptions
): boolean => {
  if (options.type && card.type !== options.type) {
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

  if (options.tag) {
    const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])];
    const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
    if (!tagSet.has(options.tag)) {
      return false;
    }
  }

  return !card.isDeleted;
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

  if (options.favorited !== undefined) {
    filteredQuery = filteredQuery.eq(
      "isFavorited",
      options.favorited ? true : undefined
    );
  }

  return filteredQuery;
};

const sortCards = (cards: Doc<"cards">[], sort: ApiCardSort): Doc<"cards">[] =>
  cards.sort((left, right) => compareCards(left, right, sort));

const encodeCursor = (cursor: ApiCursor): string =>
  btoa(JSON.stringify(cursor));

const decodeCursor = (cursor?: string): ApiCursor => {
  if (!cursor) {
    return { mode: "index", cursor: null, pageOffset: 0 };
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as ApiCursor;

    if (parsed.mode === "offset" && typeof parsed.offset === "number") {
      return { mode: "offset", offset: Math.max(0, parsed.offset) };
    }

    if (parsed.mode === "index") {
      return {
        mode: "index",
        cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
        pageOffset:
          typeof parsed.pageOffset === "number" &&
          Number.isFinite(parsed.pageOffset)
            ? Math.max(0, parsed.pageOffset)
            : 0,
      };
    }
  } catch {
    return { mode: "index", cursor: null, pageOffset: 0 };
  }

  return { mode: "index", cursor: null, pageOffset: 0 };
};

const searchCardsByQuery = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions,
  offset: number
): Promise<Doc<"cards">[]> => {
  const searchQuery = normalizeSearchText(options.searchQuery);
  if (!searchQuery) {
    return [];
  }

  const limit = normalizeLimit(options.limit);
  const desiredLimit = Math.min(MAX_QUERY_SCAN, offset + limit + 1);
  const searchLimit = Math.max(
    desiredLimit * SEARCH_MULTIPLIER,
    desiredLimit + 20
  );

  const searchResults = await Promise.all(
    SEARCH_INDEXES.map(({ field, index }) =>
      ctx.db
        .query("cards")
        .withSearchIndex(index, (query: any) =>
          applySearchIndexFilters(query, userId, options).search(
            field,
            searchQuery
          )
        )
        .take(searchLimit)
    )
  );

  const unique = Array.from(
    new Map(searchResults.flat().map((card) => [card._id, card])).values()
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortCards(unique, normalizeSort(options.sort));
};

const searchCardsByTag = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions,
  offset: number
): Promise<Doc<"cards">[]> => {
  const tag = normalizeTag(options.tag);
  if (!tag) {
    return [];
  }

  const limit = normalizeLimit(options.limit);
  const desiredLimit = Math.min(MAX_QUERY_SCAN, offset + limit + 1);
  const searchLimit = Math.max(
    desiredLimit * SEARCH_MULTIPLIER,
    desiredLimit + 20
  );

  const searchResults = await Promise.all([
    ctx.db
      .query("cards")
      .withSearchIndex("search_tags", (query: any) =>
        applySearchIndexFilters(query, userId, options).search("tags", tag)
      )
      .take(searchLimit),
    ctx.db
      .query("cards")
      .withSearchIndex("search_ai_tags", (query: any) =>
        applySearchIndexFilters(query, userId, options).search("aiTags", tag)
      )
      .take(searchLimit),
  ]);

  const unique = Array.from(
    new Map(searchResults.flat().map((card) => [card._id, card])).values()
  ).filter((card) => matchesStructuredFilters(card, options));

  return sortCards(unique, normalizeSort(options.sort));
};

const buildBaseQuery = (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions
) => {
  if (
    options.favorited !== undefined &&
    options.createdAfter === undefined &&
    options.createdBefore === undefined &&
    options.type === undefined
  ) {
    return ctx.db
      .query("cards")
      .withIndex("by_user_favorites_deleted", (query) =>
        query
          .eq("userId", userId)
          .eq("isFavorited", options.favorited ? true : undefined)
          .eq("isDeleted", undefined)
      );
  }

  if (
    options.createdAfter !== undefined ||
    options.createdBefore !== undefined
  ) {
    return ctx.db.query("cards").withIndex("by_created", (query) => {
      if (
        options.createdAfter !== undefined &&
        options.createdBefore !== undefined
      ) {
        return query
          .eq("userId", userId)
          .gte("createdAt", options.createdAfter)
          .lt("createdAt", options.createdBefore + 1);
      }

      if (options.createdAfter !== undefined) {
        return query
          .eq("userId", userId)
          .gte("createdAt", options.createdAfter);
      }

      if (options.createdBefore !== undefined) {
        return query
          .eq("userId", userId)
          .lt("createdAt", options.createdBefore + 1);
      }

      return query.eq("userId", userId);
    });
  }

  if (options.type) {
    return ctx.db
      .query("cards")
      .withIndex("by_user_type_deleted", (query) =>
        query
          .eq("userId", userId)
          .eq("type", options.type!)
          .eq("isDeleted", undefined)
      );
  }

  return ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (query) =>
      query.eq("userId", userId).eq("isDeleted", undefined)
    );
};

const listCardsWithBaseQuery = async (
  ctx: QueryCtx,
  userId: string,
  options: SearchOptions,
  decodedCursor: ApiCursor
) => {
  const sort = normalizeSort(options.sort);
  const limit = normalizeLimit(options.limit);
  const pageSize = limit;
  const baseQuery = buildBaseQuery(ctx, userId, options);
  const matches: Doc<"cards">[] = [];
  let cursor = decodedCursor.mode === "index" ? decodedCursor.cursor : null;
  let pageOffset =
    decodedCursor.mode === "index" ? decodedCursor.pageOffset : 0;
  let hasMore = false;
  let nextCursor: string | null = null;

  while (matches.length < limit) {
    const pageCursor = cursor;
    const page = await baseQuery
      .order(sort === "oldest" ? "asc" : "desc")
      .paginate({
        cursor: pageCursor,
        numItems: pageSize,
      });
    let filteredIndex = 0;

    for (const card of page.page as Doc<"cards">[]) {
      if (!matchesStructuredFilters(card, options)) {
        continue;
      }

      if (filteredIndex < pageOffset) {
        filteredIndex += 1;
        continue;
      }

      if (matches.length === limit) {
        hasMore = true;
        nextCursor = encodeCursor({
          mode: "index",
          cursor: pageCursor,
          pageOffset: filteredIndex,
        });
        break;
      }

      matches.push(card);
      filteredIndex += 1;
    }

    if (hasMore) {
      break;
    }

    if (page.isDone || !page.continueCursor) {
      break;
    }

    cursor = page.continueCursor;
    pageOffset = 0;
  }

  return { pageItems: matches, hasMore, nextCursor };
};

const normalizeCardsQueryOptions = (args: {
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  limit?: number;
  searchQuery?: string;
  sort?: ApiCardSort;
  tag?: string;
  type?: Doc<"cards">["type"];
}): SearchOptions => {
  const normalized: SearchOptions = {
    createdAfter: normalizeCreatedTimestamp(args.createdAfter),
    createdBefore: normalizeCreatedTimestamp(args.createdBefore),
    favorited: args.favorited,
    limit: normalizeLimit(args.limit),
    searchQuery: normalizeSearchText(args.searchQuery),
    sort: normalizeSort(args.sort),
    tag: normalizeTag(args.tag),
    type: args.type,
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

export const listCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    cursor: v.optional(v.string()),
    searchQuery: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    tag: v.optional(v.string()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    limit: v.optional(v.number()),
  },
  returns: paginatedCardsResultValidator,
  handler: async (ctx, args) => {
    const options = normalizeCardsQueryOptions(args);
    const limit = normalizeLimit(options.limit);
    const decodedCursor = decodeCursor(args.cursor);
    let pageItems: Doc<"cards">[];
    let hasMore: boolean;
    let nextCursor: string | null;

    if (options.searchQuery) {
      const offset = decodedCursor.mode === "offset" ? decodedCursor.offset : 0;
      const sorted = await searchCardsByQuery(
        ctx,
        args.userId,
        options,
        offset
      );
      pageItems = sorted.slice(offset, offset + limit);
      hasMore = sorted.length > offset + limit;
      nextCursor = hasMore
        ? encodeCursor({ mode: "offset", offset: offset + limit })
        : null;
    } else if (options.tag) {
      const offset = decodedCursor.mode === "offset" ? decodedCursor.offset : 0;
      const sorted = await searchCardsByTag(ctx, args.userId, options, offset);
      pageItems = sorted.slice(offset, offset + limit);
      hasMore = sorted.length > offset + limit;
      nextCursor = hasMore
        ? encodeCursor({ mode: "offset", offset: offset + limit })
        : null;
    } else {
      const page = await listCardsWithBaseQuery(
        ctx,
        args.userId,
        options,
        decodedCursor
      );
      pageItems = page.pageItems;
      hasMore = page.hasMore;
      nextCursor = page.nextCursor;
    }

    const cardsWithUrls = await attachFileUrls(ctx, pageItems);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      pageInfo: {
        nextCursor,
        hasMore,
      },
    };
  },
});

export const listTagsForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.array(tagSummaryValidator),
  handler: async (ctx, args) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (query) =>
        query.eq("userId", args.userId).eq("isDeleted", undefined)
      )
      .collect();

    const counts = new Map<string, number>();
    for (const card of cards) {
      for (const tag of card.tags ?? []) {
        const normalized = tag.trim();
        if (!normalized) {
          continue;
        }

        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => {
        if (left.count === right.count) {
          return left.name.localeCompare(right.name);
        }
        return right.count - left.count;
      });
  },
});

export const listCardChangesForUser = internalQuery({
  args: {
    userId: v.string(),
    since: v.number(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: changesResultValidator,
  handler: async (ctx, args) => {
    const limit = normalizeLimit(args.limit);
    const page = await ctx.db
      .query("cards")
      .withIndex("by_updated", (query) =>
        query.eq("userId", args.userId).gte("updatedAt", args.since)
      )
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: limit,
      });

    const activeCards = page.page.filter((card) => !card.isDeleted);
    const cardsWithUrls = await attachFileUrls(ctx, activeCards);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      deletedIds: page.page
        .filter((card) => Boolean(card.isDeleted))
        .map((card) => card._id),
      pageInfo: {
        nextCursor: page.isDone ? null : page.continueCursor,
        hasMore: !page.isDone,
      },
    };
  },
});

type BulkOperation = "create" | "update" | "favorite" | "delete";

const performBulkUpdate = async (
  ctx: MutationCtx,
  args: {
    userId: string;
    cardId: Id<"cards">;
    content?: string;
    url?: string;
    notes?: string | null;
    tags?: string[];
  }
) => {
  const requestedFields: Array<"content" | "url" | "notes" | "tags"> = [];
  let shouldSchedulePipeline = false;

  if (args.content !== undefined) requestedFields.push("content");
  if (args.url !== undefined) requestedFields.push("url");
  if (args.notes !== undefined) requestedFields.push("notes");
  if (args.tags !== undefined) requestedFields.push("tags");

  for (const field of requestedFields) {
    const result = await updateCardFieldForUserHandler(
      ctx,
      {
        userId: args.userId,
        cardId: args.cardId,
        field,
        value:
          field === "content"
            ? args.content
            : field === "url"
              ? args.url
              : field === "notes"
                ? args.notes
                : args.tags,
      },
      { deferPipelineSchedule: true }
    );
    shouldSchedulePipeline =
      shouldSchedulePipeline || result.shouldSchedulePipeline;
  }

  return shouldSchedulePipeline;
};

const assertBulkCreatePayload = (payload: Record<string, unknown>) => {
  const content =
    typeof payload.content === "string" ? payload.content.trim() : undefined;
  const url = typeof payload.url === "string" ? payload.url.trim() : undefined;

  if (!(content || url)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item must include `content` or `url`",
    });
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
      v.literal("delete")
    ),
    items: v.array(v.any()),
  },
  returns: bulkResultValidator,
  handler: async (ctx, args) => {
    const results: Record<string, unknown>[] = [];
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
            const cardId = await createCardForUserHandler(ctx, args.userId, {
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
              type:
                typeof payload.url === "string" && payload.url.trim()
                  ? "link"
                  : undefined,
            });

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

            const shouldSchedulePipeline = await performBulkUpdate(ctx, {
              userId: args.userId,
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
            if (shouldSchedulePipeline) {
              await ctx.scheduler.runAfter(
                0,
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
          case "delete": {
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

            if (args.operation === "favorite") {
              assertBulkFavoritePayload(payload);
              await updateCardFieldForUserHandler(ctx, {
                userId: args.userId,
                cardId,
                field: "isFavorited",
                value: payload.isFavorited,
              });
            } else {
              await updateCardFieldForUserHandler(ctx, {
                userId: args.userId,
                cardId,
                field: "delete",
              });
            }

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
        const message =
          error instanceof ConvexError &&
          typeof error.data?.message === "string"
            ? error.data.message
            : error instanceof Error
              ? error.message
              : "Bulk operation failed";

        results.push({
          index,
          status: "error",
          error: message,
        });
      }
    }

    return {
      operation: args.operation,
      results,
      summary: {
        total: args.items.length,
        succeeded,
        failed: args.items.length - succeeded,
      },
    };
  },
});
