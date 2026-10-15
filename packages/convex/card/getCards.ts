import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import {
  cardTypeValidator,
  cardValidator,
  searchModeValidator,
} from "../schema";
import { readSemanticRanking } from "../search/semanticCache";
import { getSessionUser } from "../securitySessions";
import {
  clampPageSize,
  clampSearchLimit,
  clampSearchOffset,
} from "../shared/search/constants";
import {
  hasSearchQualifiers,
  parseSearchQuery,
} from "../shared/search/qualifiers";
import {
  fuseRankings,
  SEMANTIC_MIN_SCORE,
  semanticQueryText,
} from "../shared/search/semantic";
import { isShuffleSeed, shuffleBySeed } from "../shared/search/shuffle";
import {
  type ArchivedFilter,
  buildCardListQuery,
  buildFolderCardListQuery,
  buildHostCardListQuery,
  buildTagCardListQuery,
  type CardListSort,
  cardListSortValidator,
  cardListSortWithShuffleValidator,
  compareCardsByCreatedAt,
  normalizeCardListSort,
} from "./listQuery";
import {
  attachCardSummaryUrls,
  attachFileUrls,
  attachGridFileUrls,
  ensureValidRange,
  isCreatedAtInRange,
} from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";
import {
  loadSemanticMatches,
  searchCardsByDocument,
} from "./searchDocumentHelpers";
import { expandFolderSearch, resolveSearch } from "./searchPlanner";
import {
  decodeShuffleWalkCursor,
  encodeShuffleWalkCursor,
  pageShuffleWalk,
  type ShuffleWalkOptions,
} from "./shuffle";
import {
  applyCardLevelFilters,
  doesCardMatchVisualFilters,
  findVisualMatches,
  normalizeVisualFilterArgs,
  visualFilterTypes,
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
  scrubUrl: v.optional(v.string()),
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
  /**
   * A search result matched by meaning (shared/search/semantic.ts), which
   * need not contain the searched words; clients keep it when they narrow
   * results to the words.
   */
  matchedByMeaning: v.optional(v.literal(true)),
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

// Paginated search pages are cut from this many best matches, sorted by date.
const SEARCH_PAGE_CANDIDATE_LIMIT = 401;
/** The most results one search index query returns. */
const SEARCH_INDEX_RESULT_LIMIT = 1024;

const isSearchTooBroadError = (error: unknown): boolean =>
  error instanceof ConvexError &&
  (error.data as { code?: unknown } | undefined)?.code === "INVALID_INPUT";
export const getSearchResultLimit = (desiredLimit: number) =>
  Math.max(1, desiredLimit);
/** Folder rows a color, style or favorites view of one folder reads per page. */
const FOLDER_FILTER_SCAN_BATCH = 200;
/**
 * Shuffle of a tag or folder: how many of its rows (the newest) are put in
 * seeded order. Rows are small; only a page's cards are loaded.
 */
const SHUFFLE_ROW_LIMIT = 2000;
/** Rows a filtered Shuffle walk reads at most per page. */
const SHUFFLE_WALK_SCAN_LIMIT = 400;

/** The cards behind index rows, in order, skipping any since deleted. */
const loadCards = async (
  ctx: QueryCtx,
  cardIds: readonly Doc<"cards">["_id"][]
): Promise<Doc<"cards">[]> => {
  const cards: Doc<"cards">[] = [];
  for (const cardId of cardIds) {
    const card = await ctx.db.get("cards", cardId);
    if (card) {
      cards.push(card);
    }
  }
  return cards;
};

export const getCards = query({
  args: {
    type: v.optional(cardTypeValidator),
    favoritesOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }

    const query = buildCardListQuery(ctx, {
      userId: user.teakUserId,
      favoritesOnly: args.favoritesOnly,
      types: args.type ? [args.type] : undefined,
    });

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
    showArchivedOnly: v.optional(v.boolean()),
    styleFilters: v.optional(v.array(v.string())),
    hueFilters: v.optional(v.array(v.string())),
    hexFilters: v.optional(v.array(v.string())),
    createdAtRange: v.optional(createdAtRangeValidator),
    limit: v.optional(v.number()),
    sort: v.optional(cardListSortValidator),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
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
    const archived: ArchivedFilter = args.showArchivedOnly ? "only" : "exclude";
    const limit = clampSearchLimit(args.limit);
    const sort = normalizeCardListSort(args.sort);
    const order = sort === "oldest" ? "asc" : "desc";
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
        const favorites = await buildCardListQuery(ctx, {
          userId: user.teakUserId,
          favoritesOnly: true,
        })
          .order(order)
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
        const trashed = await buildCardListQuery(ctx, {
          userId: user.teakUserId,
          trash: true,
        })
          .order(order)
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
        userId: user.teakUserId,
        searchQuery,
        isDeleted: showTrashOnly ? true : undefined,
        archived,
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

      const limitedResults = filteredResults
        .sort((a, b) => compareCardsByCreatedAt(a, b, sort))
        .slice(0, limit);

      const resultsWithUrls = await attachFileUrls(ctx, limitedResults);
      return applyQuoteFormattingToList(resultsWithUrls);
    }

    // No search query: colors and styles read the library in date order.
    if (visualFilters.hasVisualFilters) {
      const visualResults = await findVisualMatches(ctx, {
        userId: user.teakUserId,
        showTrashOnly,
        archived,
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
        limit: Math.max(limit * 3, limit + 40),
        sort,
      });
      const limitedVisualResults = visualResults.slice(0, limit);
      const visualResultsWithUrls = await attachFileUrls(
        ctx,
        limitedVisualResults
      );
      return applyQuoteFormattingToList(visualResultsWithUrls);
    }

    const cards = await buildCardListQuery(ctx, {
      userId: user.teakUserId,
      trash: showTrashOnly,
      archived,
      favoritesOnly,
      types,
      createdAt: createdAtRange
        ? { gte: createdAtRange.start, lt: createdAtRange.end }
        : undefined,
    })
      .order(order)
      .take(limit);
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
  /** The Archive view: archived cards that are not in Trash. */
  showArchivedOnly: v.optional(v.boolean()),
  styleFilters: v.optional(v.array(v.string())),
  hueFilters: v.optional(v.array(v.string())),
  hexFilters: v.optional(v.array(v.string())),
  createdAtRange: v.optional(createdAtRangeValidator),
  sort: v.optional(cardListSortWithShuffleValidator),
  /** Shuffle's seed: the same seed gives the same order. Defaults to 0. */
  shuffleSeed: v.optional(v.number()),
  /** Only cards in this folder (the folder view). */
  folderId: v.optional(v.id("folders")),
  /**
   * For a smart folder, the search the client last read for it. The view
   * runs this search, so a page's cursor always belongs to the search that
   * issued it and editing the folder starts a new query; without it, the
   * stored search. Any search the user could type is fine here.
   */
  folderQuery: v.optional(v.string()),
  /** Only cards with this tag (user or AI), matched ignoring case. */
  tag: v.optional(v.string()),
  /**
   * How a search finds cards (shared/search/semantic.ts); hybrid when
   * missing. Meaning matches come from `requestSemanticResults`, which the
   * client starts with the same search: this query merges them in when they
   * are cached, and stays keyword-only until then.
   */
  mode: v.optional(searchModeValidator),
  /**
   * Ignored. A client retrying a failed read sends a new one, so its cached
   * query hooks subscribe afresh instead of returning the cached error.
   */
  retryKey: v.optional(v.string()),
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
  const user = await getSessionUser(ctx);
  if (!user) {
    return { page: [], isDone: true, continueCursor: null };
  }

  const {
    paginationOpts: rawPaginationOpts,
    showTrashOnly,
    styleFilters,
    hueFilters,
    hexFilters,
    createdAtRange,
  } = args;
  const emptyPage = { page: [], isDone: true, continueCursor: null };
  const sort: CardListSort = normalizeCardListSort(args.sort);
  const order = sort === "oldest" ? "asc" : "desc";
  // Qualifiers in the search (`tag:`, `type:`, `is:fav`, `site:`, `folder:`)
  // merge into the view's own filters; the words left over search the text.
  // A smart folder's own search joins the typed one.
  const view = await expandFolderSearch(
    ctx,
    user.teakUserId,
    args.folderId,
    args.searchQuery ?? "",
    args.folderQuery
  );
  if (!view) {
    return emptyPage;
  }
  const parsed = parseSearchQuery(view.searchQuery);
  const resolved = await resolveSearch(ctx, user.teakUserId, parsed, {
    archived: args.showArchivedOnly ? "only" : "exclude",
    favoritesOnly: args.favoritesOnly,
    folderId: view.folderId,
    tag: args.tag,
    trash: showTrashOnly,
    types: args.types,
  });
  // A folder that is missing, being deleted or another user's, an unknown
  // `folder:` name, or a `type:` outside the view lists nothing.
  if (!resolved) {
    return emptyPage;
  }
  const { archived, types, sites } = resolved;
  const favoritesOnly = resolved.favoritesOnly || undefined;
  const searchQuery = resolved.text;
  // The first folder or tag can drive a read; `matches` checks the rest.
  const folderId = resolved.folderIds[0];
  const tag = resolved.tags[0] ?? "";
  // List scans check a card's own fields; the full-text path below passes
  // the search document's text, which also holds extracted file text.
  const matchesQualifiers = (card: Doc<"cards">) => resolved.matches(card);
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
  const createdAtBounds = createdAtRange
    ? { gte: createdAtRange.start, lt: createdAtRange.end }
    : undefined;

  // Shuffle: the library is walked by each card's random key from a point
  // the seed picks; a bounded set of matches (a search, tag, folder, site
  // or colors) is put in the seed's order instead (shared/search/shuffle.ts).
  const shuffle = sort === "shuffle";
  const seed = isShuffleSeed(args.shuffleSeed) ? args.shuffleSeed : 0;
  const offsetPage = async <T>(
    ordered: T[],
    load: (items: T[]) => Promise<Doc<"cards">[]>
  ) => {
    const parsedCursor = Number(paginationOpts.cursor ?? "0");
    // Bounded by the set itself (up to SHUFFLE_ROW_LIMIT), not by a
    // search's offset cap, so every card of a large tag or folder is reached.
    const offset = Math.min(
      Number.isFinite(parsedCursor) && parsedCursor > 0
        ? Math.floor(parsedCursor)
        : 0,
      ordered.length
    );
    const pageSize = clampPageSize(paginationOpts.numItems);
    const cards = await load(ordered.slice(offset, offset + pageSize));
    const isDone = ordered.length <= offset + pageSize;
    const pageWithUrls = await attachListUrls(ctx, cards);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone,
      continueCursor: isDone ? null : String(offset + pageSize),
    };
  };
  const shuffleWalkPage = async (
    walk: Omit<ShuffleWalkOptions, "seed" | "userId">,
    keep?: (cards: Doc<"cards">[]) => Doc<"cards">[]
  ) => {
    // A cursor from another walk (an older format) starts over.
    const position = decodeShuffleWalkCursor(seed, paginationOpts.cursor) ?? {
      segment: 0,
      page: null,
    };
    const filtered = Boolean(
      keep || walk.favoritesOnly || walk.types?.length || walk.createdAt
    );
    const result = await pageShuffleWalk(
      ctx,
      { ...walk, seed, userId: user.teakUserId },
      position,
      {
        numItems: keep
          ? Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH)
          : paginationOpts.numItems,
        maximumRowsRead: filtered ? SHUFFLE_WALK_SCAN_LIMIT : undefined,
      }
    );
    const cards = keep ? keep(result.cards) : result.cards;
    const pageWithUrls = await attachListUrls(ctx, cards);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone: result.next === null,
      continueCursor: result.next
        ? encodeShuffleWalkCursor(seed, result.next)
        : null,
    };
  };

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    // The bare quick commands list the whole library, so with a folder, a
    // tag or any qualifier the words are searched like any other.
    const quickCommand = !(
      folderId ||
      tag ||
      hasSearchQualifiers(parsed) ||
      parsed.phrases.length > 0
    );

    if (
      quickCommand &&
      ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
    ) {
      if (shuffle) {
        return shuffleWalkPage({ favoritesOnly: true }, (cards) =>
          applyCardLevelFilters(cards, {
            types,
            favoritesOnly: true,
            createdAtRange,
            visualFilters,
          })
        );
      }
      const favorites = await buildCardListQuery(ctx, {
        userId: user.teakUserId,
        favoritesOnly: true,
      })
        .order(order)
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

    if (
      quickCommand &&
      ["trash", "deleted", "bin", "recycle", "trashed"].includes(query)
    ) {
      if (shuffle) {
        return shuffleWalkPage({ trash: true }, (cards) =>
          applyCardLevelFilters(cards, {
            types,
            favoritesOnly,
            createdAtRange,
            visualFilters,
          })
        );
      }
      const trashed = await buildCardListQuery(ctx, {
        userId: user.teakUserId,
        trash: true,
      })
        .order(order)
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

    const typesSet = new Set(types || []);
    const hasMultiTypeFilter = typesSet.size > 1;
    const matchesFilters = (card: Doc<"cards">, searchableText?: string) =>
      resolved.matches(card, searchableText) &&
      isCreatedAtInRange(card.createdAt, createdAtRange) &&
      (!hasMultiTypeFilter || typesSet.has(card.type)) &&
      doesCardMatchVisualFilters(card, visualFilters);
    const searchArgs = {
      userId: user.teakUserId,
      searchQuery,
      isDeleted: showTrashOnly ? true : undefined,
      archived,
      isFavorited: favoritesOnly ? true : undefined,
      type: types?.length === 1 ? types[0] : undefined,
      urlHost: sites.length === 1 ? sites[0] : undefined,
      limit: SEARCH_PAGE_CANDIDATE_LIMIT,
    };
    // Meaning matches, when this search's are cached. Semantic mode with
    // none cached falls back to keyword results.
    const mode = args.mode ?? "hybrid";
    const semanticText = mode === "keyword" ? "" : semanticQueryText(parsed);
    const ranking = semanticText
      ? await readSemanticRanking(ctx, user.teakUserId, semanticText)
      : null;
    const keywordSearch = !(mode === "semantic" && ranking);
    // Every page sorts the same candidate set, so offsets never overlap or
    // skip between pages.
    let searchResults: Doc<"cards">[] = [];
    const searchTexts = new Map<Id<"cards">, string>();
    try {
      if (keywordSearch) {
        searchResults = await searchCardsByDocument(ctx, {
          ...searchArgs,
          resultFilter: matchesFilters,
          searchTexts,
        });
      }
    } catch (error) {
      if (!isSearchTooBroadError(error)) {
        throw error;
      }
      // A saturated search with selective filters: filter every match the
      // index returned (not just the first page of candidates) instead of
      // failing the grid, so a folder keeps the matches the filtered pass
      // already found.
      searchResults = await searchCardsByDocument(ctx, {
        ...searchArgs,
        limit: SEARCH_INDEX_RESULT_LIMIT,
        searchTexts,
      });
    }
    const uniqueResults = searchResults
      .filter((card) => matchesFilters(card, searchTexts.get(card._id)))
      .slice(0, SEARCH_PAGE_CANDIDATE_LIMIT);

    // Multi-type filtering happens during dedupe; single-type/favorites are filtered at index level.
    let filteredResults = uniqueResults;
    const matchedByMeaning = new Set<Id<"cards">>();
    if (ranking) {
      // Fusion picks which cards are in the set; the sort below orders it.
      const cardsById = new Map(
        uniqueResults.map((card) => [card._id, card] as const)
      );
      const semantic = await loadSemanticMatches(
        ctx,
        searchArgs,
        ranking,
        cardsById,
        { minScore: SEMANTIC_MIN_SCORE, keep: (card) => matchesFilters(card) }
      );
      for (const match of semantic) {
        if (match.score >= SEMANTIC_MIN_SCORE) {
          matchedByMeaning.add(match.cardId);
        }
      }
      filteredResults = fuseRankings(
        uniqueResults.map((card) => card._id),
        semantic,
        { mode, limit: SEARCH_PAGE_CANDIDATE_LIMIT }
      ).flatMap((cardId) => cardsById.get(cardId) ?? []);
    }

    const sortedResults = shuffle
      ? shuffleBySeed(filteredResults, seed, (card) => card._id)
      : filteredResults.sort((a, b) => compareCardsByCreatedAt(a, b, sort));
    const page = sortedResults
      .slice(offset, offset + pageSize)
      .map((card) =>
        matchedByMeaning.has(card._id)
          ? { ...card, matchedByMeaning: true as const }
          : card
      );
    const isDone = sortedResults.length <= offset + pageSize;
    const continueCursor = isDone ? null : String(offset + pageSize);

    const pageWithUrls = await attachListUrls(ctx, page);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone,
      continueCursor,
    };
  }

  // A tag: page through the tag's index rows in date order. Folders and
  // colors or styles filter each batch here, so a batch can hold no match
  // while more remain; the grid then loads the next one.
  if (tag) {
    // A card changes before its tag rows catch up, so check the card itself
    // still has the tag and belongs in this view.
    const inView = (card: Doc<"cards">) => {
      if (showTrashOnly) {
        return card.isDeleted === true;
      }
      if (card.isDeleted === true) {
        return false;
      }
      return archived === "only"
        ? card.isArchived === true
        : card.isArchived !== true;
    };
    const keepTagMatches = (cards: Doc<"cards">[]) =>
      applyCardLevelFilters(
        cards.filter((card) => matchesQualifiers(card) && inView(card)),
        { types, favoritesOnly, createdAtRange, visualFilters }
      );
    if (shuffle) {
      const rows = await buildTagCardListQuery(ctx, {
        userId: user.teakUserId,
        tag,
        trash: showTrashOnly,
        archived,
        types,
        favoritesOnly,
        createdAt: createdAtBounds,
      })
        .order("desc")
        .take(SHUFFLE_ROW_LIMIT);
      const cardIds = Array.from(new Set(rows.map((row) => row.cardId)));
      return offsetPage(
        shuffleBySeed(cardIds, seed, (cardId) => cardId),
        async (pageIds) => keepTagMatches(await loadCards(ctx, pageIds))
      );
    }
    const filtersCards =
      Boolean(folderId) ||
      visualFilters.hasVisualFilters ||
      resolved.hasCardFilters;
    const rows = await buildTagCardListQuery(ctx, {
      userId: user.teakUserId,
      tag,
      trash: showTrashOnly,
      archived,
      types,
      favoritesOnly,
      createdAt: createdAtBounds,
    })
      .order(order)
      .paginate({
        cursor: paginationOpts.cursor,
        numItems: filtersCards
          ? Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH)
          : paginationOpts.numItems,
      });
    const matches = keepTagMatches(
      await loadCards(
        ctx,
        rows.page.map((row) => row.cardId)
      )
    );
    const pageWithUrls = await attachListUrls(ctx, matches);
    return {
      ...rows,
      page: applyQuoteFormattingToList(pageWithUrls),
    };
  }

  // Colors, styles and favorites inside a folder: the library-wide search
  // indexes can't narrow to one folder, so page through the folder's own
  // rows (in date order) and filter each batch here. A batch can hold no
  // match while more remain; the grid then loads the next one.
  // Shuffle of a folder: its newest rows in the seed's order, each page's
  // cards checked against the view's filters.
  if (folderId && shuffle) {
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      trash: showTrashOnly,
      archived,
      types,
      createdAt: createdAtBounds,
    })
      .order("desc")
      .take(SHUFFLE_ROW_LIMIT);
    return offsetPage(
      shuffleBySeed(
        rows.map((row) => row.cardId),
        seed,
        (cardId) => cardId
      ),
      async (pageIds) =>
        applyCardLevelFilters(
          (await loadCards(ctx, pageIds)).filter(matchesQualifiers),
          { types, favoritesOnly, createdAtRange, visualFilters }
        )
    );
  }

  if (
    folderId &&
    (visualFilters.hasVisualFilters || favoritesOnly || resolved.hasCardFilters)
  ) {
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      trash: showTrashOnly,
      archived,
      types,
      createdAt: createdAtBounds,
    })
      .order(order)
      .paginate({
        cursor: paginationOpts.cursor,
        numItems: Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH),
      });
    const cards: Doc<"cards">[] = [];
    for (const row of rows.page) {
      const card = await ctx.db.get("cards", row.cardId);
      if (card && matchesQualifiers(card)) {
        cards.push(card);
      }
    }
    const matches = applyCardLevelFilters(cards, {
      types,
      favoritesOnly,
      createdAtRange,
      visualFilters,
    });
    const pageWithUrls = await attachListUrls(ctx, matches);
    return {
      ...rows,
      page: applyQuoteFormattingToList(pageWithUrls),
    };
  }

  // Sites, phrases, colors, styles and the other card-level filters without
  // a folder or tag: one site reads its host index, anything else the
  // library list, and each batch is filtered here like the folder views
  // above. Colors and styles are arrays, which no search index covers.
  if (resolved.hasCardFilters || visualFilters.hasVisualFilters) {
    const scanTypes = visualFilterTypes(types, visualFilters);
    if (scanTypes?.length === 0) {
      return emptyPage;
    }
    const host =
      sites.length === 1 && !showTrashOnly && archived !== "include"
        ? sites[0]
        : undefined;
    const keepMatches = (cards: Doc<"cards">[]) =>
      applyCardLevelFilters(cards.filter(matchesQualifiers), {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });
    // Shuffle walks the whole library with the same filters (a site
    // included), so no matching card is left out.
    if (shuffle) {
      return shuffleWalkPage(
        {
          trash: showTrashOnly,
          archived,
          favoritesOnly,
          types: scanTypes,
          createdAt: createdAtBounds,
        },
        keepMatches
      );
    }
    const driver = host
      ? buildHostCardListQuery(ctx, {
          userId: user.teakUserId,
          host,
          archived: archived === "only" ? "only" : "exclude",
          createdAt: createdAtBounds,
        })
      : buildCardListQuery(ctx, {
          userId: user.teakUserId,
          trash: showTrashOnly,
          archived,
          favoritesOnly,
          types: scanTypes,
          createdAt: createdAtBounds,
        });
    // The host index alone answers a site with no other card filter, so
    // every row matches and the page keeps the size asked for.
    const exact =
      host !== undefined &&
      !types?.length &&
      !favoritesOnly &&
      resolved.phrases.length === 0 &&
      !visualFilters.hasVisualFilters;
    const rows = await driver.order(order).paginate({
      cursor: paginationOpts.cursor,
      numItems: exact
        ? paginationOpts.numItems
        : Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH),
    });
    const matches = applyCardLevelFilters(rows.page.filter(matchesQualifiers), {
      types,
      favoritesOnly,
      createdAtRange,
      visualFilters,
    });
    const pageWithUrls = await attachListUrls(ctx, matches);
    return {
      ...rows,
      page: applyQuoteFormattingToList(pageWithUrls),
    };
  }

  if (folderId) {
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      trash: showTrashOnly,
      archived,
      types,
      createdAt: createdAtBounds,
    })
      .order(order)
      .paginate(paginationOpts);
    const folderCards: Doc<"cards">[] = [];
    for (const row of rows.page) {
      const card = await ctx.db.get("cards", row.cardId);
      if (card) {
        folderCards.push(card);
      }
    }
    const folderCardsWithUrls = await attachListUrls(ctx, folderCards);
    return {
      ...rows,
      page: applyQuoteFormattingToList(folderCardsWithUrls),
    };
  }

  if (shuffle) {
    return shuffleWalkPage({
      trash: showTrashOnly,
      archived,
      favoritesOnly,
      types,
      createdAt: createdAtBounds,
    });
  }

  const cards = await buildCardListQuery(ctx, {
    userId: user.teakUserId,
    trash: showTrashOnly,
    archived,
    favoritesOnly,
    types,
    createdAt: createdAtBounds,
  })
    .order(order)
    .paginate(paginationOpts);
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
