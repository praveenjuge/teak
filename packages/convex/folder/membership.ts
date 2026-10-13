import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import {
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDERS_PER_CARD,
} from "../shared/folders";
import { requireFolderForUser } from "./folders";

const cardNotFound = () =>
  new ConvexError({ code: "NOT_FOUND", message: "Card not found" });

const folderLimit = () =>
  new ConvexError({
    code: "FOLDER_LIMIT",
    message: FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS_ON_CARD,
  });

const requireOwnedCard = async (
  ctx: MutationCtx,
  userId: string,
  cardId: Id<"cards">
): Promise<Doc<"cards">> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    throw cardNotFound();
  }
  return card;
};

const sameFolders = (
  a: readonly Id<"folders">[],
  b: readonly Id<"folders">[]
) => a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Writes a card's folder list through the card sync, so its folder rows,
 * folder counts and `updatedAt` (read by /v1/cards/changes) move together.
 * An unchanged list writes nothing.
 */
const writeCardFolders = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  next: Id<"folders">[]
): Promise<boolean> => {
  if (sameFolders(card.folderIds ?? [], next)) {
    return false;
  }
  if (next.length > MAX_FOLDERS_PER_CARD) {
    throw folderLimit();
  }
  return await patchCardWithSearchSync(ctx, card._id, {
    folderIds: next.length > 0 ? next : undefined,
    updatedAt: Date.now(),
  });
};

/** The folders in `folderIds` that are being deleted but can still be restored. */
const foldersBeingDeleted = async (
  ctx: MutationCtx,
  folderIds: readonly Id<"folders">[]
): Promise<Id<"folders">[]> => {
  const deleting: Id<"folders">[] = [];
  for (const id of folderIds) {
    const folder = await ctx.db.get("folders", id);
    if (folder?.deletingAt !== undefined) {
      deleting.push(id);
    }
  }
  return deleting;
};

/**
 * Replaces the card's folders with `folderIds` (the order given, duplicates
 * dropped). Every folder must be the user's.
 */
export const setCardFoldersForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">,
  folderIds: readonly string[]
): Promise<Id<"folders">[]> => {
  const card = await requireOwnedCard(ctx, userId, cardId);
  const next: Id<"folders">[] = [];
  for (const id of folderIds) {
    const folder = await requireFolderForUser(ctx, userId, id);
    if (!next.includes(folder._id)) {
      next.push(folder._id);
    }
  }
  // A folder deleted moments ago is hidden from the caller but can still be
  // restored; keep the card in it so Undo brings the folder back whole.
  for (const id of await foldersBeingDeleted(ctx, card.folderIds ?? [])) {
    if (!next.includes(id)) {
      next.push(id);
    }
  }
  if (next.length > MAX_FOLDERS_PER_CARD) {
    throw folderLimit();
  }
  await writeCardFolders(ctx, card, next);
  return next;
};

export type FolderMembershipAction = "add" | "remove" | "move";

/**
 * Adds one card to the folder, removes it, or moves it there. Move takes the
 * card out of `fromFolderId` when given (the folder being viewed), otherwise
 * out of every folder, and puts it in the target. Repeating an action is a
 * no-op. Throws NOT_FOUND for a card that is missing or another user's, and
 * FOLDER_LIMIT when the card is already in MAX_FOLDERS_PER_CARD folders.
 */
export const applyFolderMembership = async (
  ctx: MutationCtx,
  args: {
    action: FolderMembershipAction;
    cardId: Id<"cards">;
    folderId: Id<"folders">;
    fromFolderId?: Id<"folders">;
    userId: TeakUserId;
  }
): Promise<void> => {
  const card = await requireOwnedCard(ctx, args.userId, args.cardId);
  const current = card.folderIds ?? [];
  let next: Id<"folders">[];
  switch (args.action) {
    case "add":
      next = current.includes(args.folderId)
        ? current
        : [...current, args.folderId];
      break;
    case "remove":
      next = current.filter((id) => id !== args.folderId);
      break;
    case "move": {
      // Without a source, the card leaves every folder except ones still in
      // their Undo window, so Undo brings those back whole.
      const kept = args.fromFolderId
        ? current.filter((id) => id !== args.fromFolderId)
        : await foldersBeingDeleted(ctx, current);
      next = kept.includes(args.folderId) ? kept : [...kept, args.folderId];
      break;
    }
    default:
      throw new Error(
        `Unsupported folder action: ${args.action satisfies never}`
      );
  }
  await writeCardFolders(ctx, card, next);
};

/**
 * Applies a folder action to up to MAX_FOLDER_CARD_IDS cards. The folder
 * must be the user's (and the source folder, for a move); each card then
 * succeeds or fails on its own, and failed cards are left unchanged.
 */
export const applyFolderMembershipToCards = async (
  ctx: MutationCtx,
  args: {
    action: FolderMembershipAction;
    cardIds: readonly Id<"cards">[];
    folderId: string;
    fromFolderId?: string;
    userId: TeakUserId;
  }
): Promise<{
  failedIds: Id<"cards">[];
  folderLimitIds: Id<"cards">[];
  updatedIds: Id<"cards">[];
}> => {
  const cardIds = Array.from(new Set(args.cardIds));
  if (cardIds.length === 0) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Choose at least one card",
    });
  }
  if (cardIds.length > MAX_FOLDER_CARD_IDS) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Change at most ${MAX_FOLDER_CARD_IDS} cards at a time`,
    });
  }
  const folder = await requireFolderForUser(ctx, args.userId, args.folderId);
  const fromFolder =
    args.action === "move" && args.fromFolderId
      ? await requireFolderForUser(ctx, args.userId, args.fromFolderId)
      : undefined;

  const updatedIds: Id<"cards">[] = [];
  const failedIds: Id<"cards">[] = [];
  const folderLimitIds: Id<"cards">[] = [];
  for (const cardId of cardIds) {
    try {
      await applyFolderMembership(ctx, {
        action: args.action,
        cardId,
        folderId: folder._id,
        fromFolderId: fromFolder?._id,
        userId: args.userId,
      });
      updatedIds.push(cardId);
    } catch (error) {
      failedIds.push(cardId);
      if (
        error instanceof ConvexError &&
        (error.data as { code?: unknown })?.code === "FOLDER_LIMIT"
      ) {
        folderLimitIds.push(cardId);
      }
    }
  }
  return { updatedIds, failedIds, folderLimitIds };
};

const membershipResultValidator = v.object({
  updatedIds: v.array(v.id("cards")),
  failedIds: v.array(v.id("cards")),
  folderLimitIds: v.array(v.id("cards")),
});

const requireUserId = async (ctx: MutationCtx) => {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Sign in to change folders",
    });
  }
  return user.teakUserId;
};

export const addCardsToFolder = mutation({
  args: { folderId: v.id("folders"), cardIds: v.array(v.id("cards")) },
  returns: membershipResultValidator,
  handler: async (ctx, args) =>
    applyFolderMembershipToCards(ctx, {
      ...args,
      action: "add",
      userId: await requireUserId(ctx),
    }),
});

export const removeCardsFromFolder = mutation({
  args: { folderId: v.id("folders"), cardIds: v.array(v.id("cards")) },
  returns: membershipResultValidator,
  handler: async (ctx, args) =>
    applyFolderMembershipToCards(ctx, {
      ...args,
      action: "remove",
      userId: await requireUserId(ctx),
    }),
});

export const moveCardsToFolder = mutation({
  args: {
    folderId: v.id("folders"),
    cardIds: v.array(v.id("cards")),
    fromFolderId: v.optional(v.id("folders")),
  },
  returns: membershipResultValidator,
  handler: async (ctx, args) =>
    applyFolderMembershipToCards(ctx, {
      ...args,
      action: "move",
      userId: await requireUserId(ctx),
    }),
});

/** Sets one card's folders, as the card modal's Folders checklist does. */
export const setCardFolders = mutation({
  args: { cardId: v.id("cards"), folderIds: v.array(v.id("folders")) },
  returns: v.array(v.id("folders")),
  handler: async (ctx, args) =>
    setCardFoldersForUser(
      ctx,
      await requireUserId(ctx),
      args.cardId,
      args.folderIds
    ),
});
