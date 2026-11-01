import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { cardTypeValidator, searchModeValidator } from "../schema";
import { readRelevanceScores } from "../search/relevanceCache";
import { readSemanticRanking } from "../search/semanticCache";
import { getSessionUser } from "../securitySessions";
import { clampPageSize, clampSearchOffset } from "../shared/search/constants";
import {
  hasSearchQualifiers,
  parseSearchQuery,
} from "../shared/search/qualifiers";
import {
  currentRelevanceScores,
  orderByRelevance,
} from "../shared/search/relevance";
import {
  fuseRankings,
  SEMANTIC_MIN_SCORE,
  semanticQueryText,
  similarityRequest,
} from "../shared/search/semantic";
import { isShuffleSeed, shuffleBySeed } from "../shared/search/shuffle";
import { keepVisible } from "./hiddenCards";
import {
  buildCardListQuery,
  buildFolderCardListQuery,
  buildHostCardListQuery,
  buildTagCardListQuery,
  CARD_LIST_PAGE_ROW_LIMIT,
  type CardListSort,
  cardListScope,
  cardListSortWithShuffleValidator,
  compareCardsBySavedAt,
  normalizeCardListSort,
  savedAtOf,
} from "./listQuery";
import {
  attachCardSummaryUrls,
  attachFileUrls,
  attachGridFileUrls,
  ensureValidRange,
  isSavedAtInRange,
} from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";
import {
  expandFolderSearch,
  expressionTextReader,
  resolveSearch,
} from "./searchPlanner";
import {
  loadSemanticMatches,
  type SearchCandidate,
  searchCandidateOf,
  searchCandidatesByDocument,
  searchCardsByDocument,
  searchCardsByOcrText,
} from "./searchReads";
import {
  decodeShuffleWalkCursor,
  encodeShuffleWalkCursor,
  pageShuffleWalk,
  type ShuffleWalkOptions,
} from "./shuffle";
import { isSimilarAnchorAvailable, loadSimilarCards } from "./similarSearch";
import {
  applyCardLevelFilters,
  doesCardMatchVisualFilters,
  normalizeVisualFilterArgs,
  visualFilterTypes,
} from "./visualFilters";

export const createdAtRangeValidator = v.object({
  start: v.number(),
  end: v.number(),
});

const SEARCH_PAGE_CANDIDATE_LIMIT = 401;
const SEARCH_INDEX_RESULT_LIMIT = 1024;

const isSearchTooBroadError = (error: unknown): boolean =>
  error instanceof ConvexError &&
  (error.data as { code?: unknown } | undefined)?.code === "INVALID_INPUT";
const FOLDER_FILTER_SCAN_BATCH = 200;
const SHUFFLE_ROW_LIMIT = 2000;
const SHUFFLE_WALK_SCAN_LIMIT = 400;

const loadCards = async (
  ctx: QueryCtx,
  cardIds: readonly Doc<"cards">["_id"][]
): Promise<Doc<"cards">[]> =>
  (
    await Promise.all(cardIds.map((cardId) => ctx.db.get("cards", cardId)))
  ).filter((card): card is Doc<"cards"> => card !== null);
export const searchCardsPaginatedArgsValidator = v.object({
  paginationOpts: paginationOptsValidator,
  searchQuery: v.optional(v.string()),
  types: v.optional(v.array(cardTypeValidator)),
  favoritesOnly: v.optional(v.boolean()),
  showTrashOnly: v.optional(v.boolean()),
  showArchivedOnly: v.optional(v.boolean()),
  styleFilters: v.optional(v.array(v.string())),
  hueFilters: v.optional(v.array(v.string())),
  hexFilters: v.optional(v.array(v.string())),
  createdAtRange: v.optional(createdAtRangeValidator),
  sort: v.optional(cardListSortWithShuffleValidator),
  shuffleSeed: v.optional(v.number()),
  folderId: v.optional(v.id("folders")),
  folderQuery: v.optional(v.string()),
  tag: v.optional(v.string()),
  mode: v.optional(searchModeValidator),
  useRelevanceScores: v.optional(v.boolean()),
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
  let attachUrls = attachFileUrls;
  if (options.summariesOnly) {
    attachUrls = attachCardSummaryUrls;
  } else if (options.gridOnly) {
    attachUrls = attachGridFileUrls;
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
  if (!resolved) {
    return emptyPage;
  }
  const { archived, types, sites, includeHidden } = resolved;
  const scope = cardListScope(archived, showTrashOnly);
  // Every page passes through here, so a hidden card the backfill hasn't
  // flagged yet never reaches the client, whichever read found it.
  const attachListUrls = (listCtx: QueryCtx, cards: Doc<"cards">[]) =>
    attachUrls(listCtx, keepVisible(cards, includeHidden));
  const favoritesOnly = resolved.favoritesOnly || undefined;
  const searchQuery = resolved.text;
  const folderId = resolved.folderIds[0];
  const tag = resolved.tags[0] ?? "";
  const readExpressionText = expressionTextReader(ctx, parsed.expression);
  const keepQualified = async (cards: Doc<"cards">[]) => {
    const texts = await Promise.all(cards.map(readExpressionText));
    return cards.filter((card, index) => resolved.matches(card, texts[index]));
  };
  const paginationOpts = {
    ...rawPaginationOpts,
    numItems: clampPageSize(rawPaginationOpts.numItems),
    maximumRowsRead: Math.min(
      rawPaginationOpts.maximumRowsRead ?? CARD_LIST_PAGE_ROW_LIMIT,
      CARD_LIST_PAGE_ROW_LIMIT
    ),
  };
  ensureValidRange(createdAtRange);
  const visualFilters = normalizeVisualFilterArgs({
    styleFilters,
    hueFilters,
    hexFilters,
  });
  // Date words keep the `createdAtRange` name for clients and bound the
  // saved date.
  const savedAtBounds = createdAtRange
    ? { gte: createdAtRange.start, lt: createdAtRange.end }
    : undefined;

  const shuffle = sort === "shuffle";
  const seed = isShuffleSeed(args.shuffleSeed) ? args.shuffleSeed : 0;
  const offsetPage = async <T>(
    ordered: T[],
    load: (items: T[]) => Promise<Doc<"cards">[]>
  ) => {
    const parsedCursor = Number(paginationOpts.cursor ?? "0");
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
    keep?: (cards: Doc<"cards">[]) => Doc<"cards">[] | Promise<Doc<"cards">[]>
  ) => {
    const position = decodeShuffleWalkCursor(seed, paginationOpts.cursor) ?? {
      segment: 0,
      page: null,
    };
    // Leaving hidden cards out filters the walk too, so it reads within a
    // row budget however many hidden cards a segment holds.
    const filtered = Boolean(
      keep ||
        walk.favoritesOnly ||
        walk.types?.length ||
        walk.savedAt ||
        !includeHidden
    );
    const result = await pageShuffleWalk(
      ctx,
      { ...walk, includeHidden, seed, userId: user.teakUserId },
      position,
      {
        numItems: keep
          ? Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH)
          : paginationOpts.numItems,
        maximumRowsRead: filtered ? SHUFFLE_WALK_SCAN_LIMIT : undefined,
      }
    );
    const cards = keep ? await keep(result.cards) : result.cards;
    const pageWithUrls = await attachListUrls(ctx, cards);
    return {
      page: applyQuoteFormattingToList(pageWithUrls),
      isDone: result.next === null,
      continueCursor: result.next
        ? encodeShuffleWalkCursor(seed, result.next)
        : null,
    };
  };

  if (resolved.similarity) {
    const { similarity } = resolved;
    const request = similarityRequest(similarity);
    if (
      request.kind === "like" &&
      !(await isSimilarAnchorAvailable(ctx, user.teakUserId, request.cardId))
    ) {
      return emptyPage;
    }
    const ranking = await readSemanticRanking(
      ctx,
      user.teakUserId,
      request.cacheText
    );
    if (!ranking) {
      return emptyPage;
    }
    const inView = (card: Doc<"cards">) => {
      if (showTrashOnly) {
        return card.isDeleted === true;
      }
      if (card.isDeleted === true) {
        return false;
      }
      if (archived === "include") {
        return true;
      }
      return archived === "only"
        ? card.isArchived === true
        : card.isArchived !== true;
    };
    const similar = await loadSimilarCards(ctx, {
      userId: user.teakUserId,
      similarity,
      ranking,
      keep: (card, searchableText) =>
        inView(card) &&
        resolved.matches(card, searchableText) &&
        isSavedAtInRange(savedAtOf(card), createdAtRange) &&
        doesCardMatchVisualFilters(card, visualFilters),
      text: parsed.text,
      readText: readExpressionText,
    });
    const ordered = shuffle
      ? shuffleBySeed(similar, seed, (card) => card._id)
      : similar.sort((a, b) => compareCardsBySavedAt(a, b, sort));
    return offsetPage(ordered, (cards) =>
      Promise.resolve(
        cards.map((card) => ({ ...card, matchedByMeaning: true as const }))
      )
    );
  }

  if (searchQuery || resolved.ocrText) {
    const query = searchQuery.toLowerCase();
    const quickCommand = !(
      folderId ||
      tag ||
      hasSearchQualifiers(parsed) ||
      parsed.phrases.length > 0 ||
      parsed.expression
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
        return shuffleWalkPage({ scope: "trash" }, (cards) =>
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
        scope: "trash",
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
      isSavedAtInRange(savedAtOf(card), createdAtRange) &&
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
      includeHidden,
      limit: SEARCH_PAGE_CANDIDATE_LIMIT,
    };
    const mode = args.mode ?? "hybrid";
    const semanticText = mode === "keyword" ? "" : semanticQueryText(parsed);
    const ranking = semanticText
      ? await readSemanticRanking(ctx, user.teakUserId, semanticText)
      : null;
    const keywordSearch = !(mode === "semantic" && ranking);
    const relevanceText = sort === "relevance" ? semanticQueryText(parsed) : "";
    const pageOf = async (
      ordered: SearchCandidate[],
      matchedByMeaning: ReadonlySet<Id<"cards">>
    ) => {
      const cards = await Promise.all(
        ordered
          .slice(offset, offset + pageSize)
          .map(
            (candidate) =>
              candidate.card ?? ctx.db.get("cards", candidate.cardId)
          )
      );
      const page = cards.flatMap((card) => {
        if (!card) {
          return [];
        }
        return matchedByMeaning.has(card._id)
          ? [{ ...card, matchedByMeaning: true as const }]
          : [card];
      });
      const isDone = ordered.length <= offset + pageSize;
      const pageWithUrls = await attachListUrls(ctx, page);
      return {
        page: applyQuoteFormattingToList(pageWithUrls),
        isDone,
        continueCursor: isDone ? null : String(offset + pageSize),
      };
    };
    const { matchesDocument } = resolved;
    // When every filter reads search document fields, the matches are ranked
    // from their documents and only the page's cards are loaded. Visual
    // filters, image text and stored relevance scores need every card.
    if (
      matchesDocument &&
      !resolved.ocrText &&
      !visualFilters.hasVisualFilters &&
      !(relevanceText && args.useRelevanceScores)
    ) {
      const keepDocument = (
        document: Doc<"cardSearchDocuments">,
        savedAt: number
      ) =>
        matchesDocument(document) &&
        isSavedAtInRange(savedAt, createdAtRange) &&
        (!hasMultiTypeFilter || typesSet.has(document.type));
      const keeps = (candidate: SearchCandidate) =>
        candidate.document
          ? keepDocument(candidate.document, candidate.savedAt)
          : candidate.card !== undefined &&
            matchesFilters(candidate.card, candidate.searchableText);
      let candidates: SearchCandidate[] = [];
      try {
        if (keywordSearch) {
          candidates = await searchCandidatesByDocument(ctx, {
            ...searchArgs,
            keepDocument,
            resultFilter: matchesFilters,
          });
        }
      } catch (error) {
        if (!isSearchTooBroadError(error)) {
          throw error;
        }
        candidates = await searchCandidatesByDocument(ctx, {
          ...searchArgs,
          limit: SEARCH_INDEX_RESULT_LIMIT,
        });
      }
      const matched = candidates
        .filter(keeps)
        .slice(0, SEARCH_PAGE_CANDIDATE_LIMIT);
      let ordered = matched;
      const matchedByMeaning = new Set<Id<"cards">>();
      if (ranking) {
        const keywordMatches = new Map(
          matched.map((candidate) => [candidate.cardId, candidate] as const)
        );
        const meaningMatches = new Map<Id<"cards">, Doc<"cards">>();
        const semantic = await loadSemanticMatches(
          ctx,
          searchArgs,
          ranking,
          {
            has: (cardId) =>
              keywordMatches.has(cardId) || meaningMatches.has(cardId),
            set: (cardId, card) => meaningMatches.set(cardId, card),
          },
          {
            minScore: SEMANTIC_MIN_SCORE,
            keep: matchesFilters,
            withText: resolved.phrases.length > 0,
            readText: readExpressionText,
          }
        );
        for (const match of semantic) {
          if (
            match.score >= SEMANTIC_MIN_SCORE &&
            !keywordMatches.has(match.cardId)
          ) {
            matchedByMeaning.add(match.cardId);
          }
        }
        ordered = fuseRankings(
          matched.map((candidate) => candidate.cardId),
          semantic,
          { mode, limit: SEARCH_PAGE_CANDIDATE_LIMIT }
        ).flatMap((cardId) => {
          const candidate = keywordMatches.get(cardId);
          if (candidate) {
            return [candidate];
          }
          const card = meaningMatches.get(cardId);
          return card ? [searchCandidateOf(card)] : [];
        });
      }
      if (shuffle) {
        ordered = shuffleBySeed(ordered, seed, (candidate) => candidate.cardId);
      } else if (!relevanceText) {
        ordered.sort((left, right) =>
          compareCardsBySavedAt(
            {
              createdAt: left.savedAt,
              savedAt: left.savedAt,
              _creationTime: left.creationTime,
            },
            {
              createdAt: right.savedAt,
              savedAt: right.savedAt,
              _creationTime: right.creationTime,
            },
            sort
          )
        );
      }
      return pageOf(ordered, matchedByMeaning);
    }
    let searchResults: Doc<"cards">[] = [];
    const searchTexts = new Map<Id<"cards">, string>();
    const readKeywordMatches = async (
      options: Pick<typeof searchArgs, "limit"> & {
        resultFilter?: typeof matchesFilters;
      }
    ) => {
      const read = { ...searchArgs, ...options, searchTexts };
      if (!resolved.ocrText) {
        return searchCardsByDocument(ctx, read);
      }
      const imageMatches = await searchCardsByOcrText(ctx, {
        ...read,
        searchQuery: resolved.ocrText,
      });
      if (!searchQuery) {
        return imageMatches;
      }
      const wordMatches = new Set(
        (await searchCardsByDocument(ctx, read)).map((card) => card._id)
      );
      return imageMatches.filter((card) => wordMatches.has(card._id));
    };
    try {
      if (keywordSearch) {
        searchResults = await readKeywordMatches({
          limit: SEARCH_PAGE_CANDIDATE_LIMIT,
          resultFilter: matchesFilters,
        });
      }
    } catch (error) {
      if (!isSearchTooBroadError(error)) {
        throw error;
      }
      searchResults = await readKeywordMatches({
        limit: SEARCH_INDEX_RESULT_LIMIT,
      });
    }
    const uniqueResults = searchResults
      .filter((card) => matchesFilters(card, searchTexts.get(card._id)))
      .slice(0, SEARCH_PAGE_CANDIDATE_LIMIT);

    let filteredResults = uniqueResults;
    const matchedByMeaning = new Set<Id<"cards">>();
    if (ranking) {
      const cardsById = new Map(
        uniqueResults.map((card) => [card._id, card] as const)
      );
      const keywordMatches = new Set(cardsById.keys());
      const semantic = await loadSemanticMatches(
        ctx,
        searchArgs,
        ranking,
        cardsById,
        {
          minScore: SEMANTIC_MIN_SCORE,
          keep: matchesFilters,
          withText: resolved.phrases.length > 0,
          readText: readExpressionText,
        }
      );
      for (const match of semantic) {
        if (
          match.score >= SEMANTIC_MIN_SCORE &&
          !keywordMatches.has(match.cardId)
        ) {
          matchedByMeaning.add(match.cardId);
        }
      }
      filteredResults = fuseRankings(
        uniqueResults.map((card) => card._id),
        semantic,
        { mode, limit: SEARCH_PAGE_CANDIDATE_LIMIT }
      ).flatMap((cardId) => cardsById.get(cardId) ?? []);
    }

    let sortedResults: Doc<"cards">[];
    if (shuffle) {
      sortedResults = shuffleBySeed(filteredResults, seed, (card) => card._id);
    } else if (relevanceText) {
      sortedResults = args.useRelevanceScores
        ? orderByRelevance(
            filteredResults,
            currentRelevanceScores(
              await readRelevanceScores(ctx, user.teakUserId, relevanceText),
              filteredResults
            )
          )
        : filteredResults;
    } else {
      sortedResults = filteredResults.sort((a, b) =>
        compareCardsBySavedAt(a, b, sort)
      );
    }
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

  if (tag) {
    const inView = (card: Doc<"cards">) => {
      if (showTrashOnly) {
        return card.isDeleted === true;
      }
      if (card.isDeleted === true) {
        return false;
      }
      if (archived === "include") {
        return true;
      }
      return archived === "only"
        ? card.isArchived === true
        : card.isArchived !== true;
    };
    const keepTagMatches = async (cards: Doc<"cards">[]) =>
      applyCardLevelFilters((await keepQualified(cards)).filter(inView), {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });
    if (shuffle) {
      const rows = await buildTagCardListQuery(ctx, {
        userId: user.teakUserId,
        tag,
        scope,
        types,
        favoritesOnly,
        savedAt: savedAtBounds,
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
      scope,
      types,
      favoritesOnly,
      savedAt: savedAtBounds,
    })
      .order(order)
      .paginate({
        cursor: paginationOpts.cursor,
        // A split page asks for the rows up to its end; without it each
        // half comes back whole and the client splits it forever.
        endCursor: paginationOpts.endCursor,
        maximumRowsRead: paginationOpts.maximumRowsRead,
        numItems: filtersCards
          ? Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH)
          : paginationOpts.numItems,
      });
    const matches = await keepTagMatches(
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

  if (folderId && shuffle) {
    const rows = await buildFolderCardListQuery(ctx, {
      folderId,
      scope,
      types,
      savedAt: savedAtBounds,
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
          await keepQualified(await loadCards(ctx, pageIds)),
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
      scope,
      types,
      savedAt: savedAtBounds,
    })
      .order(order)
      .paginate({
        cursor: paginationOpts.cursor,
        // A split page asks for the rows up to its end; without it each
        // half comes back whole and the client splits it forever.
        endCursor: paginationOpts.endCursor,
        maximumRowsRead: paginationOpts.maximumRowsRead,
        numItems: Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH),
      });
    const cards = await keepQualified(
      await loadCards(
        ctx,
        rows.page.map((row) => row.cardId)
      )
    );
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

  if (resolved.hasCardFilters || visualFilters.hasVisualFilters) {
    const visualScanTypes = visualFilterTypes(types, visualFilters);
    if (visualScanTypes === "none") {
      return emptyPage;
    }
    const scanTypes = visualScanTypes === "any" ? undefined : visualScanTypes;
    const host =
      sites.length === 1 && !showTrashOnly && archived !== "include"
        ? sites[0]
        : undefined;
    const keepMatches = async (cards: Doc<"cards">[]) =>
      applyCardLevelFilters(await keepQualified(cards), {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });
    if (shuffle) {
      return shuffleWalkPage(
        {
          scope,
          favoritesOnly,
          types: scanTypes,
          savedAt: savedAtBounds,
        },
        keepMatches
      );
    }
    const driver = host
      ? buildHostCardListQuery(ctx, {
          userId: user.teakUserId,
          host,
          includeHidden,
          scope: archived === "only" ? "archive" : "library",
          savedAt: savedAtBounds,
        })
      : buildCardListQuery(ctx, {
          userId: user.teakUserId,
          scope,
          favoritesOnly,
          includeHidden,
          types: scanTypes,
          savedAt: savedAtBounds,
        });
    const exact =
      host !== undefined &&
      !types?.length &&
      !favoritesOnly &&
      resolved.phrases.length === 0 &&
      !visualFilters.hasVisualFilters;
    const rows = await driver.order(order).paginate({
      cursor: paginationOpts.cursor,
      endCursor: paginationOpts.endCursor,
      maximumRowsRead: paginationOpts.maximumRowsRead,
      numItems: exact
        ? paginationOpts.numItems
        : Math.max(paginationOpts.numItems, FOLDER_FILTER_SCAN_BATCH),
    });
    const matches = applyCardLevelFilters(await keepQualified(rows.page), {
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
      scope,
      types,
      savedAt: savedAtBounds,
    })
      .order(order)
      .paginate(paginationOpts);
    const folderCards = await loadCards(
      ctx,
      rows.page.map((row) => row.cardId)
    );
    const folderCardsWithUrls = await attachListUrls(ctx, folderCards);
    return {
      ...rows,
      page: applyQuoteFormattingToList(folderCardsWithUrls),
    };
  }

  if (shuffle) {
    return shuffleWalkPage({
      scope,
      favoritesOnly,
      types,
      savedAt: savedAtBounds,
    });
  }

  const cards = await buildCardListQuery(ctx, {
    userId: user.teakUserId,
    scope,
    favoritesOnly,
    types,
    savedAt: savedAtBounds,
  })
    .order(order)
    .paginate(paginationOpts);
  const cardsWithUrls = await attachListUrls(ctx, cards.page);
  return {
    ...cards,
    page: applyQuoteFormattingToList(cardsWithUrls),
  };
};
