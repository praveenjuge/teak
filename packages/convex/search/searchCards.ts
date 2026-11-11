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
import {
  attachGridFileUrls,
  ensureValidRange,
  finishCards,
} from "../card/queryUtils";
import {
  applyCardLevelFilters,
  findVisualMatches,
  normalizeVisualFilterArgs,
} from "../card/visualFilters";
import { cardTypeValidator } from "../schema/validators/cards";
import { getSessionUser } from "../securitySessions";
import {
  clampSearchLimit,
  resolveQuickSearchCommand,
} from "../shared/search/constants";
import { withReadMeter } from "./readMeter";
import {
  createdAtRangeValidator,
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./searchCardsPaginated";
import { quickCommandList } from "./searchPlanner";
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
      const command = resolveQuickSearchCommand(searchQuery);
      if (command) {
        const view = quickCommandList(command, favoritesOnly);
        const listed = await takeCardList(
          ctx,
          { userId: user.teakUserId, ...view.list },
          order,
          limit
        );
        const filtered = applyCardLevelFilters(keepVisible(listed), {
          types,
          favoritesOnly: view.favoritesOnly,
          createdAtRange,
          visualFilters,
        }).slice(0, limit);
        return finishCards(filtered);
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

      return finishCards(limitedResults);
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
      return finishCards(limitedVisualResults);
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
    return finishCards(cards);
  },
});

export const searchCardsPaginated = query({
  args: searchCardsPaginatedArgsValidator.fields,
  returns: paginationResultValidator,
  handler: (ctx, args) =>
    withReadMeter(ctx, args, (metered, reportSearch) =>
      searchCardsPaginatedHandler(metered, args, {
        attach: attachGridFileUrls,
        reportSearch,
      })
    ),
});
