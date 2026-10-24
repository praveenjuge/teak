import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { articleSourceOf } from "./highlight/anchorPending";
import {
  createHighlightForUser,
  HIGHLIGHT_ERROR_MESSAGES,
  highlightableArticle,
  highlightReturnValidator,
  listHighlightsForUser,
  removeHighlightForUser,
  updateHighlightNoteForUser,
} from "./highlight/highlights";
import { requireTeakUserId } from "./securitySessions";

const notFound = (message: string): never => {
  throw new ConvexError({ code: "NOT_FOUND", message });
};

const cardIdOf = (ctx: Pick<QueryCtx, "db">, id: string): Id<"cards"> =>
  ctx.db.normalizeId("cards", id) ??
  notFound(HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);

const highlightIdOf = (
  ctx: Pick<QueryCtx, "db">,
  id: string
): Id<"highlights"> =>
  ctx.db.normalizeId("highlights", id) ??
  notFound(HIGHLIGHT_ERROR_MESSAGES.NOT_FOUND);

/** A card's highlights in article order; another account's card is 404. */
export const listHighlightsForApi = internalQuery({
  args: { userId: v.string(), cardId: v.string() },
  returns: v.array(highlightReturnValidator),
  handler: async (ctx, args) => {
    const rows = await listHighlightsForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      cardIdOf(ctx, args.cardId)
    );
    return rows ?? notFound(HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);
  },
});

/** The article a quote is looked for in: NOT_FOUND or NO_ARTICLE first. */
export const getHighlightArticleForApi = internalQuery({
  args: { userId: v.string(), cardId: v.string() },
  returns: v.object({
    cardId: v.id("cards"),
    imageCount: v.number(),
    textKey: v.string(),
    title: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const cardId = cardIdOf(ctx, args.cardId);
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== userId) {
      return notFound(HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);
    }
    highlightableArticle(card);
    const source = articleSourceOf(card) as NonNullable<
      ReturnType<typeof articleSourceOf>
    >;
    return { cardId, ...source };
  },
});

export const createHighlightForApi = internalMutation({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
    articleKey: v.string(),
    quote: v.string(),
    prefix: v.optional(v.string()),
    suffix: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
  },
  returns: v.object({
    created: v.boolean(),
    highlight: highlightReturnValidator,
    merged: v.boolean(),
  }),
  handler: async (ctx, { userId, ...args }) =>
    createHighlightForUser(
      ctx,
      await requireTeakUserId(ctx, userId),
      args,
      "api"
    ),
});

export const updateHighlightForApi = internalMutation({
  args: {
    userId: v.string(),
    highlightId: v.string(),
    note: v.union(v.string(), v.null()),
  },
  returns: highlightReturnValidator,
  handler: async (ctx, args): Promise<Doc<"highlights">> =>
    updateHighlightNoteForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      highlightIdOf(ctx, args.highlightId),
      args.note,
      "api"
    ),
});

export const deleteHighlightForApi = internalMutation({
  args: { userId: v.string(), highlightId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeHighlightForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      highlightIdOf(ctx, args.highlightId),
      "api"
    );
    return null;
  },
});
