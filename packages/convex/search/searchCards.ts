import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardReturnValidator } from "../card/getCards";
import { keepVisible } from "../card/hiddenCards";
import {
  type ArchivedFilter,
  cardListScope,
  cardListSortValidator,
  compareCardsBySavedAt,
  normalizeCardListSort,
  takeCardList,
} from "../card/listQuery";
import { attachFileUrls, ensureValidRange } from "../card/queryUtils";
import { applyQuoteFormattingToList } from "../card/quoteFormatting";
import {
  applyCardLevelFilters,
  findVisualMatches,
  normalizeVisualFilterArgs,
} from "../card/visualFilters";
import { cardTypeValidator } from "../schema/validators/cards";
import { getSessionUser } from "../securitySessions";
import { clampSearchLimit } from "../shared/search/constants";
import {
  createdAtRangeValidator,
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./searchCardsPaginated";
import { searchCardsByDocument } from "./searchReads";

// The search queries the apps call as `cards:searchCards` and
// `cards:searchCardsPaginated` (re-exported from `cards.ts`).

const paginationResultValidator = v.object({
  page: v.array(cardReturnValidator),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())
  ),
});

export const getSearchResultLimit = (desiredLimit: number) =>
  Math.max(1, desiredLimit);

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
    const scope = cardListScope(archived, showTrashOnly);
    const limit = clampSearchLimit(args.limit);
    const sort = normalizeCardListSort(args.sort);
    const order = sort === "oldest" ? "asc" : "desc";
    ensureValidRange(createdAtRange);
    const visualFilters = normalizeVisualFilterArgs({
      styleFilters,
      hueFilters,
      hexFilters,
    });

    if (searchQuery?.trim()) {
      const query = searchQuery.toLowerCase().trim();

      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        const favorites = await takeCardList(
          ctx,
          { userId: user.teakUserId, favoritesOnly: true },
          order,
          limit
        );
        const filteredFavorites = applyCardLevelFilters(
          keepVisible(favorites),
          {
            types,
            favoritesOnly: true,
            createdAtRange,
            visualFilters,
          }
        ).slice(0, limit);
        const favoritesWithUrls = await attachFileUrls(ctx, filteredFavorites);
        return applyQuoteFormattingToList(favoritesWithUrls);
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        const trashed = await takeCardList(
          ctx,
          { userId: user.teakUserId, scope: "trash" },
          order,
          limit
        );
        const filteredTrashed = applyCardLevelFilters(keepVisible(trashed), {
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

      const filteredResults = applyCardLevelFilters(uniqueResults, {
        types,
        favoritesOnly,
        createdAtRange,
        visualFilters,
      });

      const limitedResults = filteredResults
        .sort((a, b) => compareCardsBySavedAt(a, b, sort))
        .slice(0, limit);

      const resultsWithUrls = await attachFileUrls(ctx, limitedResults);
      return applyQuoteFormattingToList(resultsWithUrls);
    }

    if (visualFilters.hasVisualFilters) {
      const visualResults = await findVisualMatches(ctx, {
        userId: user.teakUserId,
        scope,
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

    const cards = keepVisible(
      await takeCardList(
        ctx,
        {
          userId: user.teakUserId,
          scope,
          favoritesOnly,
          types,
          savedAt: createdAtRange
            ? { gte: createdAtRange.start, lt: createdAtRange.end }
            : undefined,
        },
        order,
        limit
      )
    );
    const cardsWithUrls = await attachFileUrls(ctx, cards);
    return applyQuoteFormattingToList(cardsWithUrls);
  },
});

export const searchCardsPaginated = query({
  args: searchCardsPaginatedArgsValidator.fields,
  returns: paginationResultValidator,
  handler: (ctx, args) =>
    searchCardsPaginatedHandler(ctx, args, { gridOnly: true }),
});
