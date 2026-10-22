import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema";
import { getSessionUser } from "../securitySessions";
import { clampSearchLimit } from "../shared/search/constants";
import { isCardHidden } from "../shared/tags";
import { keepVisible } from "./hiddenCards";
import {
  type ArchivedFilter,
  buildCardListQuery,
  buildFolderCardListQuery,
  type CardListScope,
  cardListScope,
  cardListSortValidator,
  compareCardsByCreatedAt,
  normalizeCardListSort,
  takeCardList,
} from "./listQuery";
import {
  attachFileUrls,
  ensureValidRange,
  linkPreviewImageFields,
} from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";
import {
  createdAtRangeValidator,
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./searchCardsPaginated";
import { searchCardsByDocument } from "./searchReads";
import {
  applyCardLevelFilters,
  findVisualMatches,
  normalizeVisualFilterArgs,
} from "./visualFilters";

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
  ...linkPreviewImageFields,
  matchedByMeaning: v.optional(v.literal(true)),
  hasOcrText: v.optional(v.literal(true)),
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

export const getSearchResultLimit = (desiredLimit: number) =>
  Math.max(1, desiredLimit);

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

    const cards = keepVisible(
      await takeCardList(
        ctx,
        {
          userId: user.teakUserId,
          favoritesOnly: args.favoritesOnly,
          types: args.type ? [args.type] : undefined,
        },
        "desc",
        clampSearchLimit(args.limit)
      )
    );

    const cardsWithUrls = await attachFileUrls(ctx, cards);
    return applyQuoteFormattingToList(cardsWithUrls);
  },
});

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
        .sort((a, b) => compareCardsByCreatedAt(a, b, sort))
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
          createdAt: createdAtRange
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

const viewScope = (
  view: "all" | "favorites" | "archive" | "trash" | undefined
): CardListScope => {
  if (view === "trash") {
    return "trash";
  }
  return view === "archive" ? "archive" : "library";
};

/**
 * Whether an empty library view or folder is empty because its cards are
 * hidden, for the empty state's hint. The caller asks only when the view
 * shows no cards, so any card left in its index range is a hidden one: one
 * row read answers it.
 */
export const viewHasHiddenCards = query({
  args: {
    view: v.optional(
      v.union(
        v.literal("all"),
        v.literal("favorites"),
        v.literal("archive"),
        v.literal("trash")
      )
    ),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return false;
    }
    if (args.folderId) {
      const folder = await ctx.db.get("folders", args.folderId);
      if (!folder || folder.userId !== user.teakUserId) {
        return false;
      }
      const row = await buildFolderCardListQuery(ctx, {
        folderId: folder._id,
      })
        .order("desc")
        .first();
      const card = row ? await ctx.db.get("cards", row.cardId) : null;
      return card !== null && isCardHidden(card);
    }
    const card = await buildCardListQuery(ctx, {
      userId: user.teakUserId,
      includeHidden: true,
      favoritesOnly: args.view === "favorites",
      scope: viewScope(args.view),
    })
      .order("desc")
      .first();
    return card !== null && isCardHidden(card);
  },
});

export const searchCardsPaginated = query({
  args: searchCardsPaginatedArgsValidator.fields,
  returns: paginationResultValidator,
  handler: (ctx, args) =>
    searchCardsPaginatedHandler(ctx, args, { gridOnly: true }),
});
