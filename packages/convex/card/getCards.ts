import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardTypeValidator, cardValidator } from "../schema/validators/cards";
import { getSessionUser } from "../securitySessions";
import { clampSearchLimit } from "../shared/search/constants";
import { isCardHidden } from "../shared/tags";
import { keepVisible } from "./hiddenCards";
import {
  buildCardListQuery,
  buildFolderCardListQuery,
  type CardListScope,
  takeCardList,
} from "./listQuery";
import { attachFileUrls, linkPreviewImageFields } from "./queryUtils";
import { applyQuoteFormattingToList } from "./quoteFormatting";

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
  articleUrl: v.optional(v.string()),
  articleImageUrls: v.optional(v.array(v.string())),
});

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
