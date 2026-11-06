import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { articleSourceOf } from "./highlight/anchorPending";
import {
  HIGHLIGHT_ERROR_MESSAGES,
  highlightableArticle,
  highlightOwnerOperations,
  highlightReturnValidator,
  listHighlightsForUser as readCardHighlights,
} from "./highlight/highlights";
import { apiMutation } from "./ownerOperation";
import { requireTeakUserId } from "./securitySessions";

const notFound = (message: string): never => {
  throw new ConvexError({ code: "NOT_FOUND", message });
};

const cardIdOf = (ctx: Pick<QueryCtx, "db">, id: string): Id<"cards"> =>
  ctx.db.normalizeId("cards", id) ??
  notFound(HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);

export const listHighlightsForUser = internalQuery({
  args: { userId: v.string(), cardId: v.string() },
  returns: v.array(highlightReturnValidator),
  handler: async (ctx, args) => {
    const rows = await readCardHighlights(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      cardIdOf(ctx, args.cardId)
    );
    return rows ?? notFound(HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);
  },
});

export const getHighlightArticleForUser = internalQuery({
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

export const createHighlightForUser = apiMutation(
  highlightOwnerOperations.create
);
export const updateHighlightForUser = apiMutation(
  highlightOwnerOperations.updateNote
);
export const deleteHighlightForUser = apiMutation(
  highlightOwnerOperations.remove
);
