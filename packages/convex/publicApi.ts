import type { PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  applyCardAction,
  type BulkCardAction,
  normalizeBulkTags,
} from "./card/bulkActions";
import { createCardForUserHandler } from "./card/createCard";
import { cardReturnValidator } from "./card/getCards";
import {
  archivedFilterValidator,
  buildFolderCardListQuery,
  buildTagCardListQuery,
} from "./card/listQuery";
import { attachFileUrls } from "./card/queryUtils";
import { applyQuoteFormattingToList } from "./card/quoteFormatting";
import { resolveFolderNames } from "./card/searchPlanner";
import { pageShuffleWalk, shuffleSegmentCount } from "./card/shuffle";
import {
  type CardFieldEdit,
  updateCardFieldsForUserHandler,
} from "./card/updateCard";
import {
  decodeChangesCursor,
  decodeCursor,
  decodeShuffleCursor,
  encodeChangesCursor,
  encodeCursor,
  encodeShuffleCursor,
  invalidCursorError,
  isAfterShuffleAnchor,
  matchAnchorOf,
  type ShuffleApiCursor,
} from "./publicApiCursors";
import {
  explainCardTypeMismatch,
  explainInvalidTags,
  isRateLimitContentionError,
} from "./publicApiHttpShared";
import {
  apiCardSortValidator,
  isAfterMatchAnchor,
  MAX_QUERY_SCAN,
  matchesStructuredFilters,
  normalizeCardsQueryOptions,
  normalizeLimit,
  normalizeSort,
  normalizeTag,
  priceBoundValidator,
  relevancePage,
  scanCardsWithBaseQuery,
  searchCardsByQuery,
  searchCardsByTag,
  semanticOption,
  semanticSearchArgs,
  similarityOption,
} from "./publicApiSearch";
import {
  listCardTombstonesSince,
  type TombstoneCursor,
} from "./publicApiTombstones";
import { cardTypeValidator } from "./schema";
import { relevanceScoreValidator } from "./search/relevanceCache";
import { requireTeakUserId, type TeakUserId } from "./securitySessions";
import { type CardType, cardTypes } from "./shared/constants";
import { rateLimiter } from "./shared/rateLimits";
import {
  isShuffleSeed,
  shuffleBySeed,
  shuffleRank,
} from "./shared/search/shuffle";
import { isSafeExternalUrl, UnsafeUrlError } from "./shared/utils/safeUrl";
import { queueCardProcessing } from "./workflowDispatch";

const MAX_BULK_ITEMS = 100;

const pageInfoValidator = v.object({
  nextCursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

const paginatedCardsResultValidator = v.object({
  items: v.array(cardReturnValidator),
  pageInfo: pageInfoValidator,
  total: v.optional(v.number()),
});

const scannedCardsResultValidator = v.object({
  itemCursors: v.array(v.string()),
  items: v.array(cardReturnValidator),
  nextCursor: v.union(v.string(), v.null()),
  scannedRows: v.number(),
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
    v.literal("delete"),
    v.literal("archive"),
    v.literal("unarchive"),
    v.literal("addTags"),
    v.literal("removeTags"),
    v.literal("restore")
  ),
  results: v.array(v.any()),
  failedIds: v.array(v.string()),
  summary: v.object({
    total: v.number(),
    succeeded: v.number(),
    failed: v.number(),
  }),
});

export const searchCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    searchQuery: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    tag: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    limit: v.optional(v.number()),
    ...semanticSearchArgs,
    /**
     * Best match for a search: keep the search's own order, scored first
     * when `scores` (fetched by the HTTP handler) are given.
     */
    relevance: v.optional(
      v.object({ scores: v.optional(v.array(relevanceScoreValidator)) })
    ),
  },
  returns: paginatedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
    }
    const options = {
      ...normalizeCardsQueryOptions({ ...args, folderIds }),
      semantic: semanticOption(args),
      similarity: similarityOption(args),
    };
    const limit = normalizeLimit(options.limit);
    const sort = normalizeSort(options.sort);
    const decodedCursor = decodeCursor(args.cursor);
    if (
      decodedCursor.mode === "list" ||
      decodedCursor.mode === "index" ||
      (decodedCursor.mode === "relevance" && !args.relevance)
    ) {
      throw invalidCursorError();
    }
    if (args.relevance && options.searchQuery) {
      return await relevancePage(ctx, userId, options, {
        cursor: decodedCursor,
        hasCursor: Boolean(args.cursor),
        limit,
        scores: args.relevance.scores,
      });
    }
    const anchor =
      decodedCursor.mode === "match" ? decodedCursor.anchor : undefined;
    let pageItems: Doc<"cards">[];
    let hasMore: boolean;

    if (options.searchQuery || options.similarity) {
      const result = await searchCardsByQuery(ctx, userId, options);
      const remaining = anchor
        ? result.cards.filter((card) => isAfterMatchAnchor(card, anchor, sort))
        : result.cards;
      pageItems = remaining.slice(0, limit);
      hasMore = remaining.length > limit;
      if (!(hasMore || args.cursor) && result.hitScanBudget) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Search is too broad. Add a type or date filter.",
        });
      }
    } else {
      const result = await searchCardsByTag(
        ctx,
        userId,
        options,
        limit,
        anchor
      );
      pageItems = result.cards;
      hasMore = result.hasMore;
    }

    const last = pageItems[pageItems.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ mode: "match", anchor: matchAnchorOf(last) })
        : null;
    const cardsWithUrls = await attachFileUrls(ctx, pageItems);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      pageInfo: {
        nextCursor,
        hasMore: nextCursor !== null,
      },
    };
  },
});

const SHUFFLE_SET_ROWS = 2000;
const SHUFFLE_SET_LOADS = MAX_QUERY_SCAN;
const SHUFFLE_WALK_SCAN = MAX_QUERY_SCAN;

export const shuffleCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    shuffleSeed: v.number(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    searchQuery: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    tag: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    limit: v.optional(v.number()),
    ...semanticSearchArgs,
  },
  returns: paginatedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    if (!isShuffleSeed(args.shuffleSeed)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Query parameter `shuffleSeed` must be a whole number from 0 to 2147483647",
      });
    }
    const seed = args.shuffleSeed;
    const empty = { items: [], pageInfo: { nextCursor: null, hasMore: false } };
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return empty;
    }
    const options = {
      ...normalizeCardsQueryOptions({ ...args, folderIds, sort: "newest" }),
      semantic: semanticOption(args),
      similarity: similarityOption(args),
    };
    const limit = normalizeLimit(options.limit);
    const cursor = decodeShuffleCursor(seed, args.cursor);
    const respond = async (
      items: Doc<"cards">[],
      next: Exclude<ShuffleApiCursor, { mode: "start" }> | null
    ) => {
      const cardsWithUrls = await attachFileUrls(ctx, items);
      const nextCursor = next ? encodeShuffleCursor(seed, next) : null;
      return {
        items: applyQuoteFormattingToList(cardsWithUrls),
        pageInfo: { nextCursor, hasMore: nextCursor !== null },
      };
    };

    const setPage = (cards: Doc<"cards">[]) => {
      if (cursor.mode === "walk") {
        throw invalidCursorError();
      }
      const ordered = shuffleBySeed(cards, seed, (card) => card._id);
      const remaining =
        cursor.mode === "after"
          ? ordered.filter((card) =>
              isAfterShuffleAnchor(seed, card._id, cursor)
            )
          : ordered;
      const items = remaining.slice(0, limit);
      const last = items[items.length - 1];
      return respond(
        items,
        remaining.length > limit && last
          ? { mode: "after", rank: shuffleRank(seed, last._id), id: last._id }
          : null
      );
    };

    const idSetPage = async (cardIds: readonly Id<"cards">[]) => {
      if (cursor.mode === "walk") {
        throw invalidCursorError();
      }
      const ordered = shuffleBySeed([...new Set(cardIds)], seed, (id) => id);
      const remaining =
        cursor.mode === "after"
          ? ordered.filter((id) => isAfterShuffleAnchor(seed, id, cursor))
          : ordered;
      const items: Doc<"cards">[] = [];
      let examined = 0;
      while (
        examined < remaining.length &&
        items.length < limit &&
        examined < SHUFFLE_SET_LOADS
      ) {
        const card = await ctx.db.get("cards", remaining[examined]);
        examined += 1;
        if (
          card &&
          card.userId === userId &&
          matchesStructuredFilters(card, options)
        ) {
          items.push(card);
        }
      }
      const lastId = remaining[examined - 1];
      return respond(
        items,
        examined < remaining.length && lastId
          ? { mode: "after", rank: shuffleRank(seed, lastId), id: lastId }
          : null
      );
    };
    const createdAt = {
      gte: options.createdAfter,
      lte: options.createdBefore,
    };
    const types = options.type ? [options.type] : options.types;

    if (options.searchQuery || options.similarity) {
      return setPage((await searchCardsByQuery(ctx, userId, options)).cards);
    }
    const tag = normalizeTag(options.tag);
    if (tag) {
      const rows = await buildTagCardListQuery(ctx, {
        userId,
        tag,
        trash: options.showTrashOnly,
        archived: options.archived,
        types,
        favoritesOnly: options.favorited === true,
        createdAt,
      })
        .order("desc")
        .take(SHUFFLE_SET_ROWS);
      return idSetPage(rows.map((row) => row.cardId));
    }
    if (options.folderId) {
      const rows = await buildFolderCardListQuery(ctx, {
        folderId: options.folderId,
        trash: options.showTrashOnly,
        archived: options.archived,
        types,
        createdAt,
      })
        .order("desc")
        .take(SHUFFLE_SET_ROWS);
      return idSetPage(rows.map((row) => row.cardId));
    }

    if (cursor.mode === "after") {
      throw invalidCursorError();
    }
    const walk = {
      userId,
      seed,
      includeHidden: options.includeHidden,
      trash: options.showTrashOnly,
      archived: options.archived,
      favoritesOnly: options.favorited === true,
      types: options.type ? [options.type] : options.types,
      createdAt: {
        gte: options.createdAfter,
        lte: options.createdBefore,
      },
    };
    const position =
      cursor.mode === "walk" ? cursor.position : { segment: 0, page: null };
    if (position.segment >= shuffleSegmentCount(walk)) {
      throw invalidCursorError();
    }
    let result: Awaited<ReturnType<typeof pageShuffleWalk>>;
    try {
      result = await pageShuffleWalk(ctx, walk, position, {
        numItems: limit,
        maximumRowsRead: SHUFFLE_WALK_SCAN,
      });
    } catch {
      throw invalidCursorError();
    }
    return respond(
      result.cards.filter((card) => matchesStructuredFilters(card, options)),
      result.next ? { mode: "walk", position: result.next } : null
    );
  },
});

export const scanCardsPageForUser = internalQuery({
  args: {
    userId: v.string(),
    showTrashOnly: v.optional(v.boolean()),
    archived: v.optional(archivedFilterValidator),
    folderId: v.optional(v.id("folders")),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    cursor: v.optional(v.string()),
    type: v.optional(cardTypeValidator),
    types: v.optional(v.array(cardTypeValidator)),
    favorited: v.optional(v.boolean()),
    createdAfter: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
    sort: v.optional(apiCardSortValidator),
    scanLimit: v.number(),
    tags: v.optional(v.array(v.string())),
    sites: v.optional(v.array(v.string())),
    phrases: v.optional(v.array(v.string())),
    prices: v.optional(v.array(priceBoundValidator)),
    folderNames: v.optional(v.array(v.string())),
    archivedInTrash: v.optional(v.boolean()),
  },
  returns: scannedCardsResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const folderIds = await resolveFolderNames(
      ctx,
      userId,
      args.folderNames ?? []
    );
    if (!folderIds) {
      return { itemCursors: [], items: [], nextCursor: null, scannedRows: 0 };
    }
    const [firstFolder, ...otherFolders] = folderIds;
    const options = normalizeCardsQueryOptions({
      ...args,
      folderId: args.folderId ?? firstFolder,
      folderIds: args.folderId ? folderIds : otherFolders,
    });
    const scanLimit = normalizeLimit(args.scanLimit);
    const page = await scanCardsWithBaseQuery(
      ctx,
      userId,
      options,
      decodeCursor(args.cursor),
      scanLimit
    );
    const cardsWithUrls = await attachFileUrls(ctx, page.matches);

    return {
      itemCursors: page.itemCursors,
      items: applyQuoteFormattingToList(cardsWithUrls),
      nextCursor: page.nextCursor,
      scannedRows: page.scannedRows,
    };
  },
});

const MAX_TAG_ROWS_READ = 8000;
// Most distinct tags one listing counts. Each is two index lookups, and a
// function may only make so many, so a vault of many small tags stops here
// (GET /v1/tags then answers from the background tag summary).
const MAX_TAGS_READ = 500;

export const listTagsForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    items: v.array(tagSummaryValidator),
    isComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const counts: { name: string; count: number }[] = [];
    let budget = MAX_TAG_ROWS_READ;
    let tagsLeft = MAX_TAGS_READ;
    let isComplete = true;
    let previousTag: string | undefined;

    while (isComplete) {
      if (tagsLeft <= 0) {
        const more = await ctx.db
          .query("cardSearchTags")
          .withIndex("by_user_tag_deleted_created", (query) =>
            previousTag === undefined
              ? query.eq("userId", userId)
              : query.eq("userId", userId).gt("tag", previousTag)
          )
          .first();
        isComplete = more === null;
        break;
      }
      tagsLeft -= 1;
      const afterTag = previousTag;
      const next = await ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_created", (query) =>
          afterTag === undefined
            ? query.eq("userId", userId)
            : query.eq("userId", userId).gt("tag", afterTag)
        )
        .first();
      if (!next) {
        break;
      }
      budget -= 1;
      previousTag = next.tag;

      let count = 0;
      const activeRows = ctx.db
        .query("cardSearchTags")
        .withIndex("by_user_tag_deleted_archived_created_v2", (query) =>
          query
            .eq("userId", userId)
            .eq("tag", next.tag)
            .eq("isDeleted", undefined)
            .eq("isArchived", undefined)
        );
      for await (const _row of activeRows) {
        if (budget <= 0) {
          isComplete = false;
          break;
        }
        budget -= 1;
        count += 1;
      }
      if (count > 0) {
        counts.push({ name: next.tag, count });
      }
      if (budget <= 0) {
        isComplete = false;
      }
    }

    return {
      items: counts.sort((left, right) => {
        if (left.count === right.count) {
          return left.name.localeCompare(right.name);
        }
        return right.count - left.count;
      }),
      isComplete,
    };
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
    const userId = await requireTeakUserId(ctx, args.userId);
    const limit = normalizeLimit(args.limit);
    const decoded = decodeChangesCursor(args.cursor);
    let activeCards: Doc<"cards">[] = [];
    const deletedIds: Id<"cards">[] = [];
    let tombstoneAfter: TombstoneCursor | undefined;

    if (decoded.phase === "cards") {
      let page: PaginationResult<Doc<"cards">>;
      try {
        page = await ctx.db
          .query("cards")
          .withIndex("by_updated", (query) =>
            query.eq("userId", userId).gte("updatedAt", args.since)
          )
          .order("asc")
          .paginate({ cursor: decoded.cursor, numItems: limit });
      } catch {
        throw invalidCursorError();
      }
      activeCards = page.page.filter((card) => !card.isDeleted);
      for (const card of page.page) {
        if (card.isDeleted) {
          deletedIds.push(card._id);
        }
      }
      if (!page.isDone) {
        const cardsWithUrls = await attachFileUrls(ctx, activeCards);
        return {
          items: applyQuoteFormattingToList(cardsWithUrls),
          deletedIds,
          pageInfo: {
            nextCursor: encodeChangesCursor({
              phase: "cards",
              cursor: page.continueCursor,
            }),
            hasMore: true,
          },
        };
      }
    } else {
      tombstoneAfter = decoded.after;
    }

    const remaining = limit - activeCards.length - deletedIds.length;
    let hasMore = false;
    let nextCursor: string | null = null;
    if (remaining <= 0) {
      hasMore = true;
      nextCursor = encodeChangesCursor({ phase: "tombstones" });
    } else {
      const tombstones = await listCardTombstonesSince(ctx, {
        after: tombstoneAfter,
        limit: remaining,
        since: args.since,
        userId,
      });
      for (const row of tombstones.rows) {
        deletedIds.push(row.cardId);
      }
      const last = tombstones.rows[tombstones.rows.length - 1];
      if (tombstones.hasMore && last) {
        hasMore = true;
        nextCursor = encodeChangesCursor({
          phase: "tombstones",
          after: {
            creationTime: last._creationTime,
            deletedAt: last.deletedAt,
          },
        });
      }
    }

    const cardsWithUrls = await attachFileUrls(ctx, activeCards);
    return {
      items: applyQuoteFormattingToList(cardsWithUrls),
      deletedIds,
      pageInfo: { nextCursor, hasMore },
    };
  },
});

type BulkOperation =
  | "create"
  | "update"
  | "favorite"
  | "delete"
  | "archive"
  | "unarchive"
  | "addTags"
  | "removeTags"
  | "restore";

const performBulkUpdate = async (
  ctx: MutationCtx,
  args: {
    userId: TeakUserId;
    cardId: Id<"cards">;
    content?: string;
    url?: string;
    notes?: string | null;
    tags?: string[];
  }
) => {
  const edits: CardFieldEdit[] = [];
  if (args.content !== undefined) {
    edits.push({ field: "content", value: args.content });
  }
  if (args.url !== undefined) {
    edits.push({ field: "url", value: args.url });
  }
  if (args.notes !== undefined) {
    edits.push({ field: "notes", value: args.notes });
  }
  if (args.tags !== undefined) {
    edits.push({ field: "tags", value: args.tags });
  }

  const result = await updateCardFieldsForUserHandler(
    ctx,
    { userId: args.userId, cardId: args.cardId, edits },
    { deferPipelineSchedule: true }
  );
  return result.pipelineDelayMs;
};

const assertBulkCreatePayload = (payload: Record<string, unknown>) => {
  const content =
    typeof payload.content === "string" ? payload.content : undefined;
  const url = typeof payload.url === "string" ? payload.url.trim() : undefined;
  const type =
    typeof payload.cardType === "string" ? payload.cardType : undefined;

  if (content === undefined && !url) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item must include `content` or `url`",
    });
  }
  if (type !== "text" && !url && !content?.trim()) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item must include `content` or `url`",
    });
  }

  if (type && !cardTypes.includes(type as CardType)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item `cardType` must be a valid card type",
    });
  }

  if (url && !isSafeExternalUrl(url)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Each create item `url` must use the http or https scheme",
    });
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((value): value is string => typeof value === "string")
    : undefined;
  const createError =
    explainInvalidTags(tags) ??
    (url
      ? null
      : explainCardTypeMismatch({
          cardType: type,
          content,
          notes: typeof payload.notes === "string" ? payload.notes : undefined,
          tags,
        }));
  if (createError) {
    throw new ConvexError({ code: "INVALID_INPUT", message: createError });
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
      v.literal("delete"),
      v.literal("archive"),
      v.literal("unarchive"),
      v.literal("addTags"),
      v.literal("removeTags"),
      v.literal("restore")
    ),
    items: v.array(v.any()),
  },
  returns: bulkResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    if (args.items.length > MAX_BULK_ITEMS) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `\`items\` must not exceed ${MAX_BULK_ITEMS} entries per request`,
      });
    }

    const results: Record<string, unknown>[] = [];
    const failedIds: string[] = [];
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
            let requestedType: CardType | undefined;
            if (typeof payload.cardType === "string") {
              requestedType = payload.cardType as CardType;
            } else if (typeof payload.url === "string" && payload.url.trim()) {
              requestedType = "link";
            }
            const cardId = await createCardForUserHandler(
              ctx,
              userId,
              {
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
                type: requestedType,
              },
              { source: "api" }
            );

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
            const tagError = explainInvalidTags(
              Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (value): value is string => typeof value === "string"
                  )
                : undefined
            );
            if (tagError) {
              throw new ConvexError({
                code: "INVALID_INPUT",
                message: tagError,
              });
            }

            const pipelineDelayMs = await performBulkUpdate(ctx, {
              userId,
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
            if (pipelineDelayMs !== null) {
              await queueCardProcessing(ctx, cardId, {
                delayMs: pipelineDelayMs,
                reset: true,
              });
            }

            results.push({
              index,
              status: "success",
              cardId,
            });
            break;
          }
          case "favorite":
          case "delete":
          case "archive":
          case "unarchive":
          case "addTags":
          case "removeTags":
          case "restore": {
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

            let action = args.operation as BulkCardAction;
            if (args.operation === "favorite") {
              assertBulkFavoritePayload(payload);
              action = payload.isFavorited ? "favorite" : "unfavorite";
            }
            const tags =
              action === "addTags" || action === "removeTags"
                ? normalizeBulkTags(
                    Array.isArray(payload.tags)
                      ? payload.tags.filter(
                          (value): value is string => typeof value === "string"
                        )
                      : undefined
                  )
                : undefined;
            await applyCardAction(ctx, { userId, cardId, action, tags });

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
        let message = "Bulk operation failed";
        let code = "INTERNAL_ERROR";
        if (
          error instanceof ConvexError &&
          typeof error.data?.message === "string"
        ) {
          message = error.data.message;
          code =
            typeof error.data.code === "string"
              ? error.data.code
              : "BAD_REQUEST";
        } else if (error instanceof Error) {
          message = error.message;
          if (error instanceof UnsafeUrlError) {
            code = "INVALID_INPUT";
          }
        }

        results.push({
          code,
          index,
          status: "error",
          error: message,
        });
        const failedId =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>).cardId
            : undefined;
        if (typeof failedId === "string" && failedId) {
          failedIds.push(failedId);
        }
      }
    }

    return {
      operation: args.operation,
      results,
      failedIds,
      summary: {
        total: args.items.length,
        succeeded,
        failed: args.items.length - succeeded,
      },
    };
  },
});

export const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

const INVALID_API_AUTH_BUCKET_KEY = "public-api-invalid-auth";

const toRateLimitResult = (
  result: Awaited<ReturnType<typeof rateLimiter.limit>>
): { ok: boolean; retryAt?: number } => ({
  ok: result.ok,
  retryAt:
    typeof result.retryAfter === "number"
      ? Date.now() + result.retryAfter
      : undefined,
});

// Only a credential's validation mutation mints one, from the identity it
// validated, so a raw bearer token can never key the limiter.
export type ValidatedRateLimitKey = string & {
  readonly __brand: "ValidatedRateLimitKey";
};

export async function limitApiRequests(
  ctx: MutationCtx,
  rateLimitKey: ValidatedRateLimitKey
): Promise<{ ok: boolean; retryAt?: number }> {
  const key = rateLimitKey.trim();
  if (!key) {
    return { ok: false };
  }

  try {
    const result = await rateLimiter.limit(ctx, "publicApiRequests", {
      key,
      throws: false,
    });
    return toRateLimitResult(result);
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return {
        ok: false,
        retryAt: Date.now() + 1000,
      };
    }

    throw error;
  }
}

export const consumeInvalidApiAuthLimit = internalMutation({
  args: {},
  returns: rateLimitResultValidator,
  handler: async (ctx) => {
    try {
      const result = await rateLimiter.limit(ctx, "invalidApiAuth", {
        key: INVALID_API_AUTH_BUCKET_KEY,
        throws: false,
      });
      return toRateLimitResult(result);
    } catch (error) {
      if (isRateLimitContentionError(error)) {
        return {
          ok: false,
          retryAt: Date.now() + 1000,
        };
      }

      throw error;
    }
  },
});
