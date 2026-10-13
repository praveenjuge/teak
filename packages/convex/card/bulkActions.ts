import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { requireFolderForUser } from "../folder/folders";
import {
  applyFolderMembership,
  type FolderMembershipAction,
} from "../folder/membership";
import { explainInvalidTags } from "../publicApiHttpShared";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import {
  type CardFieldEdit,
  updateCardFieldForUserHandler,
  updateCardFieldsForUserHandler,
} from "./updateCard";

/** Most cards one bulk call may change; callers split larger selections. */
export const MAX_BULK_CARD_IDS = 100;
/** Most tags one Add tags or Remove tags call may name. */
export const MAX_BULK_TAGS = 20;

export const bulkCardActionValidator = v.union(
  v.literal("favorite"),
  v.literal("unfavorite"),
  v.literal("archive"),
  v.literal("unarchive"),
  v.literal("addTags"),
  v.literal("removeTags"),
  v.literal("delete"),
  v.literal("restore"),
  v.literal("addToFolder"),
  v.literal("removeFromFolder"),
  v.literal("moveToFolder")
);

export type BulkCardAction = Infer<typeof bulkCardActionValidator>;

const isTagAction = (action: BulkCardAction) =>
  action === "addTags" || action === "removeTags";

const FOLDER_ACTIONS: Partial<Record<BulkCardAction, FolderMembershipAction>> =
  {
    addToFolder: "add",
    removeFromFolder: "remove",
    moveToFolder: "move",
  };

/**
 * Trims and de-duplicates (ignoring case) the tags an Add tags or Remove tags
 * action names, and rejects a list that is empty, too long or has an
 * over-long tag.
 */
export const normalizeBulkTags = (tags: readonly string[] | undefined) => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      normalized.push(tag);
    }
  }
  if (normalized.length === 0) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Name at least one tag",
    });
  }
  if (normalized.length > MAX_BULK_TAGS) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Name at most ${MAX_BULK_TAGS} tags at a time`,
    });
  }
  const tagError = explainInvalidTags(normalized);
  if (tagError) {
    throw new ConvexError({ code: "INVALID_INPUT", message: tagError });
  }
  return normalized;
};

const tagEdits = (
  card: Doc<"cards">,
  action: "addTags" | "removeTags",
  tags: readonly string[]
): CardFieldEdit[] => {
  const current = card.tags ?? [];
  const has = (list: readonly string[], tag: string) =>
    list.some((item) => item.toLowerCase() === tag.toLowerCase());
  if (action === "addTags") {
    const added = tags.filter((tag) => !has(current, tag));
    return added.length > 0
      ? [{ field: "tags", value: [...current, ...added] }]
      : [];
  }
  // Remove tags clears a name whether the user or AI tagging added it.
  const edits: CardFieldEdit[] = [];
  const kept = current.filter((tag) => !has(tags, tag));
  if (kept.length !== current.length) {
    edits.push({ field: "tags", value: kept });
  }
  for (const aiTag of card.aiTags ?? []) {
    if (has(tags, aiTag)) {
      edits.push({ field: "removeAiTag", tagToRemove: aiTag });
    }
  }
  return edits;
};

/**
 * Applies one bulk action to one card the user owns. Repeating an action is
 * a no-op (archiving an archived card, restoring one not in Trash), so a
 * retried call never fails on cards an earlier attempt already changed.
 * Throws NOT_FOUND for a missing card or one another user owns.
 */
export const applyCardAction = async (
  ctx: MutationCtx,
  {
    userId,
    cardId,
    action,
    tags = [],
    folderId,
    fromFolderId,
  }: {
    action: BulkCardAction;
    cardId: Id<"cards">;
    /** The folder a folder action targets; the caller checked it is the user's. */
    folderId?: Id<"folders">;
    /** For a move: the folder the card leaves (the one being viewed). */
    fromFolderId?: Id<"folders">;
    tags?: readonly string[];
    userId: TeakUserId;
  }
): Promise<void> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Card not found" });
  }

  switch (action) {
    case "favorite":
    case "unfavorite": {
      const isFavorited = action === "favorite";
      if ((card.isFavorited === true) !== isFavorited) {
        await updateCardFieldForUserHandler(ctx, {
          userId,
          cardId,
          field: "isFavorited",
          value: isFavorited,
        });
      }
      return;
    }
    case "archive":
    case "unarchive":
      await updateCardFieldForUserHandler(ctx, {
        userId,
        cardId,
        field: action,
      });
      return;
    case "delete":
    case "restore":
      if ((card.isDeleted === true) !== (action === "delete")) {
        await updateCardFieldForUserHandler(ctx, {
          userId,
          cardId,
          field: action,
        });
      }
      return;
    case "addTags":
    case "removeTags": {
      const edits = tagEdits(card, action, tags);
      if (edits.length > 0) {
        await updateCardFieldsForUserHandler(ctx, { userId, cardId, edits });
      }
      return;
    }
    case "addToFolder":
    case "removeFromFolder":
    case "moveToFolder": {
      if (!folderId) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Choose a folder",
        });
      }
      await applyFolderMembership(ctx, {
        action: FOLDER_ACTIONS[action] as FolderMembershipAction,
        cardId,
        folderId,
        fromFolderId,
        userId,
      });
      return;
    }
    default:
      throw new Error(`Unsupported bulk action: ${action satisfies never}`);
  }
};

/**
 * Applies one action to up to MAX_BULK_CARD_IDS cards. Each card succeeds or
 * fails on its own: cards that are missing, owned by someone else or refused
 * (for example by the card limit on restore) come back in `failedIds` and
 * are left unchanged.
 */
export const applyBulkCardAction = async (
  ctx: MutationCtx,
  args: {
    action: BulkCardAction;
    cardIds: readonly Id<"cards">[];
    folderId?: string;
    fromFolderId?: string;
    tags?: readonly string[];
    userId: TeakUserId;
  }
): Promise<{ failedIds: Id<"cards">[]; updatedIds: Id<"cards">[] }> => {
  const cardIds = Array.from(new Set(args.cardIds));
  if (cardIds.length === 0) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Choose at least one card",
    });
  }
  if (cardIds.length > MAX_BULK_CARD_IDS) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Change at most ${MAX_BULK_CARD_IDS} cards at a time`,
    });
  }
  const tags = isTagAction(args.action)
    ? normalizeBulkTags(args.tags)
    : undefined;
  // Folder actions check the folders once: an unknown or foreign folder
  // fails the whole call instead of every card.
  const isFolderAction = FOLDER_ACTIONS[args.action] !== undefined;
  if (isFolderAction && !args.folderId) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Choose a folder",
    });
  }
  const folder =
    isFolderAction && args.folderId
      ? await requireFolderForUser(ctx, args.userId, args.folderId)
      : undefined;
  const fromFolder =
    args.action === "moveToFolder" && args.fromFolderId
      ? await requireFolderForUser(ctx, args.userId, args.fromFolderId)
      : undefined;

  const updatedIds: Id<"cards">[] = [];
  const failedIds: Id<"cards">[] = [];
  for (const cardId of cardIds) {
    try {
      await applyCardAction(ctx, {
        userId: args.userId,
        cardId,
        action: args.action,
        tags,
        folderId: folder?._id,
        fromFolderId: fromFolder?._id,
      });
      updatedIds.push(cardId);
    } catch {
      failedIds.push(cardId);
    }
  }
  return { updatedIds, failedIds };
};

export const bulkUpdateCards = mutation({
  args: {
    cardIds: v.array(v.id("cards")),
    action: bulkCardActionValidator,
    tags: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
    fromFolderId: v.optional(v.id("folders")),
  },
  returns: v.object({
    updatedIds: v.array(v.id("cards")),
    failedIds: v.array(v.id("cards")),
  }),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Sign in to change cards",
      });
    }
    return applyBulkCardAction(ctx, { ...args, userId: user.teakUserId });
  },
});
