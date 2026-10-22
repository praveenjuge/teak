import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { folderNotFound, requireFolderForUser } from "../folder/folders";
import {
  applyFolderMembership,
  type FolderMembershipAction,
  onlyAddsToTarget,
  smartFolderMembership,
} from "../folder/membership";
import { requireSessionUser, type TeakUserId } from "../securitySessions";
import { explainInvalidCardTags, normalizeTagList } from "../shared/tags";
import {
  type CardFieldEdit,
  updateCardFieldForUserHandler,
  updateCardFieldsForUserHandler,
} from "./updateCard";

export const MAX_BULK_CARD_IDS = 100;
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

export const normalizeBulkTags = (tags: readonly string[] | undefined) => {
  const normalized = normalizeTagList(tags ?? []);
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
  const tagError = explainInvalidCardTags(normalized);
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

export const applyCardAction = async (
  ctx: MutationCtx,
  {
    userId,
    cardId,
    action,
    tags = [],
    folder,
    fromFolder,
  }: {
    action: BulkCardAction;
    cardId: Id<"cards">;
    folder?: Doc<"folders">;
    fromFolder?: Doc<"folders">;
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
      if (!folder) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Choose a folder",
        });
      }
      if (
        folder.userId !== userId ||
        (fromFolder && fromFolder.userId !== userId)
      ) {
        throw folderNotFound();
      }
      await applyFolderMembership(ctx, {
        action: FOLDER_ACTIONS[action] as FolderMembershipAction,
        cardId,
        folderId: folder._id,
        fromFolderId: fromFolder?._id,
        userId,
      });
      return;
    }
    default:
      throw new Error(`Unsupported bulk action: ${action satisfies never}`);
  }
};

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
  if (folder?.kind === "smart") {
    throw smartFolderMembership();
  }
  const fromFolder =
    args.action === "moveToFolder" && args.fromFolderId
      ? await requireFolderForUser(ctx, args.userId, args.fromFolderId)
      : undefined;
  const action =
    args.action === "moveToFolder" && onlyAddsToTarget(fromFolder)
      ? "addToFolder"
      : args.action;

  const updatedIds: Id<"cards">[] = [];
  const failedIds: Id<"cards">[] = [];
  for (const cardId of cardIds) {
    try {
      await applyCardAction(ctx, {
        userId: args.userId,
        cardId,
        action,
        tags,
        folder,
        fromFolder: action === "moveToFolder" ? fromFolder : undefined,
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
    const user = await requireSessionUser(ctx);
    return applyBulkCardAction(ctx, { ...args, userId: user.teakUserId });
  },
});
