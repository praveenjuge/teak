import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { createCardForUserHandler } from "../card/createCard";
import { getCardForUserHandler } from "../card/getCard";
import { cardReturnValidator } from "../card/getCards";
import {
  type CardFieldEdit,
  updateCardFieldForUserHandler,
  updateCardFieldsForUserHandler,
} from "../card/updateCard";
import { setCardFoldersForUser } from "../folder/membership";
import { cardTypeValidator } from "../schema";
import { requireTeakUserId } from "../securitySessions";
import {
  explainInvalidCardSource,
  normalizeCardSource,
} from "../shared/cardSource";
import { explainCardTypeMismatch, explainInvalidTags } from "./http/shared";

const quickSaveResultValidator = v.object({
  status: v.literal("created"),
  cardId: v.id("cards"),
  card: v.optional(cardReturnValidator),
  // The link was already saved: that card moved to the top instead.
  resaved: v.optional(v.literal(true)),
  // The re-saved card also came back from Archive.
  wasArchived: v.optional(v.literal(true)),
});

const createCardForUserArgs = {
  userId: v.string(),
  cardType: v.optional(cardTypeValidator),
  content: v.optional(v.string()),
  url: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
  source: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
} as const;

const patchCardForUserArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
  content: v.optional(v.string()),
  metadataTitle: v.optional(v.union(v.string(), v.null())),
  url: v.optional(v.string()),
  notes: v.optional(v.union(v.string(), v.null())),
  tags: v.optional(v.array(v.string())),
  removeAiTags: v.optional(v.array(v.string())),
  isArchived: v.optional(v.boolean()),
  folderIds: v.optional(v.array(v.string())),
} as const;

const setCardFavoriteForUserArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
  isFavorited: v.boolean(),
} as const;

const setCardDoneForUserArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
  done: v.boolean(),
} as const;

const cardReferenceArgs = {
  userId: v.string(),
  cardId: v.id("cards"),
} as const;

const normalizeTags = (tags?: string[]): string[] | undefined => {
  if (!Array.isArray(tags)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  );

  return normalized.length > 0 ? normalized : undefined;
};

export const quickSaveForUser = internalMutation({
  args: createCardForUserArgs,
  returns: quickSaveResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const submittedContent = args.content;
    const normalizedUrl = args.url?.trim();
    const normalizedNotes =
      typeof args.notes === "string"
        ? args.notes.trim() || undefined
        : undefined;
    const normalizedTags = normalizeTags(args.tags);
    const normalizedSource = args.source?.trim() || undefined;

    const content = submittedContent ?? (normalizedUrl || undefined);
    if (
      content === undefined ||
      (args.cardType !== "text" && !normalizedUrl && !submittedContent?.trim())
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide `content` or `url` to create a card",
      });
    }

    const createError =
      explainInvalidTags(normalizedTags) ??
      explainInvalidCardSource(args) ??
      explainCardTypeMismatch({
        cardType: args.cardType,
        content: submittedContent,
        notes: normalizedNotes,
        tags: normalizedTags,
      });
    if (createError) {
      throw new ConvexError({ code: "INVALID_INPUT", message: createError });
    }

    const createArgs: Parameters<typeof createCardForUserHandler>[2] = {
      content,
      metadata: normalizedSource ? { source: normalizedSource } : undefined,
      notes: normalizedNotes,
      ...normalizeCardSource(args),
      tags: normalizedTags,
      type: args.cardType ?? (normalizedUrl ? "link" : undefined),
      url: normalizedUrl,
    };

    const { cardId, outcome, wasArchived } = await createCardForUserHandler(
      ctx,
      userId,
      createArgs,
      { source: "raycast" }
    );
    const card = await getCardForUserHandler(ctx, userId, cardId);

    return {
      status: "created" as const,
      card: card ?? undefined,
      cardId,
      ...(outcome === "resaved" ? { resaved: true as const } : {}),
      ...(wasArchived ? { wasArchived: true as const } : {}),
    };
  },
});

export const resolveCardIdForUserRequest = internalQuery({
  args: {
    cardId: v.string(),
  },
  returns: v.union(v.id("cards"), v.null()),
  handler: (ctx, args) => ctx.db.normalizeId("cards", args.cardId),
});

export const getCardForUser = internalQuery({
  args: cardReferenceArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) =>
    getCardForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.cardId
    ),
});

export const patchCardForUser = internalMutation({
  args: patchCardForUserArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const edits: CardFieldEdit[] = (args.removeAiTags ?? []).map(
      (tagToRemove) => ({ field: "removeAiTag" as const, tagToRemove })
    );
    if (args.content !== undefined) {
      edits.push({ field: "content", value: args.content });
    }
    if (args.url !== undefined) {
      edits.push({ field: "url", value: args.url });
    }
    if (args.metadataTitle !== undefined) {
      edits.push({ field: "metadataTitle", value: args.metadataTitle });
    }
    if (args.notes !== undefined) {
      edits.push({ field: "notes", value: args.notes });
    }
    if (args.tags !== undefined) {
      edits.push({ field: "tags", value: args.tags });
    }

    if (edits.length > 0) {
      await updateCardFieldsForUserHandler(ctx, {
        userId,
        cardId: args.cardId,
        edits,
      });
    }
    if (args.isArchived !== undefined) {
      await updateCardFieldForUserHandler(ctx, {
        userId,
        cardId: args.cardId,
        field: args.isArchived ? "archive" : "unarchive",
      });
    }
    if (args.folderIds !== undefined) {
      await setCardFoldersForUser(ctx, userId, args.cardId, args.folderIds);
    }

    return getCardForUserHandler(ctx, userId, args.cardId);
  },
});

export const softDeleteCardForUser = internalMutation({
  args: cardReferenceArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    await updateCardFieldForUserHandler(ctx, {
      userId,
      cardId: args.cardId,
      field: "delete",
    });
    return null;
  },
});

export const setCardFavoriteForUser = internalMutation({
  args: setCardFavoriteForUserArgs,
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    await updateCardFieldForUserHandler(ctx, {
      userId,
      cardId: args.cardId,
      field: "isFavorited",
      value: args.isFavorited,
    });
    return getCardForUserHandler(ctx, userId, args.cardId);
  },
});

export const setCardDoneForUser = internalMutation({
  args: setCardDoneForUserArgs,
  returns: v.union(
    v.null(),
    v.object({ card: cardReturnValidator, changed: v.boolean() })
  ),
  handler: async (ctx, args) => {
    const userId = await requireTeakUserId(ctx, args.userId);
    const before = await ctx.db.get("cards", args.cardId);
    await updateCardFieldForUserHandler(ctx, {
      userId,
      cardId: args.cardId,
      field: args.done ? "done" : "undone",
    });
    const card = await getCardForUserHandler(ctx, userId, args.cardId);
    if (!card) {
      return null;
    }
    return { card, changed: (before?.completedAt !== undefined) !== args.done };
  },
});
