import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { cardValidator } from "../schema";
import {
  applyQuoteDisplayFormatting,
  applyQuoteFormattingToList,
} from "./quoteFormatting";

// Return validator for single card - includes _id and _creationTime from Convex
const cardReturnValidator = v.object({
  ...cardValidator.fields,
  _id: v.id("cards"),
  _creationTime: v.number(),
  fileUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
});

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const card = await ctx.db.get("cards", id);
    if (!card || card.userId !== user.subject) {
      return null;
    }

    const [fileUrl, thumbnailUrl, screenshotUrl] = await Promise.all([
      card.fileId ? ctx.storage.getUrl(card.fileId) : Promise.resolve(null),
      card.thumbnailId
        ? ctx.storage.getUrl(card.thumbnailId)
        : Promise.resolve(null),
      card.metadata?.linkPreview?.screenshotStorageId
        ? ctx.storage.getUrl(card.metadata.linkPreview.screenshotStorageId)
        : Promise.resolve(null),
    ]);

    return applyQuoteDisplayFormatting({
      ...card,
      fileUrl: fileUrl || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      screenshotUrl: screenshotUrl || undefined,
    });
  },
});

export const getDeletedCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", true)
      )
      .order("desc")
      .take(args.limit || 50);

    return applyQuoteFormattingToList(cards);
  },
});

/**
 * Internal query to get card details for background tasks
 * Used by thumbnail generation and similar internal processes
 */
export const getCardInternal = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    return card;
  },
});
