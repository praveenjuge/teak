import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, mutation } from "../_generated/server";
import { patchCardWithSearchSync } from "../card/searchSync";
import { requireSessionUserId, type TeakUserId } from "../securitySessions";
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

export const smartFolderMembership = () =>
  new ConvexError({
    code: "SMART_FOLDER",
    message: FOLDER_ERROR_MESSAGES.SMART_FOLDER_MEMBERSHIP,
  });

export const onlyAddsToTarget = (fromFolder: Doc<"folders"> | undefined) =>
  fromFolder?.kind === "smart";

const sameFolders = (
  a: readonly Id<"folders">[],
  b: readonly Id<"folders">[]
) => a.length === b.length && a.every((id, index) => id === b[index]);

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
    if (folder.kind === "smart") {
      throw smartFolderMembership();
    }
    if (!next.includes(folder._id)) {
      next.push(folder._id);
    }
  }
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
  if (folder.kind === "smart") {
    throw smartFolderMembership();
  }
  const fromFolder =
    args.action === "move" && args.fromFolderId
      ? await requireFolderForUser(ctx, args.userId, args.fromFolderId)
      : undefined;
  const action =
    args.action === "move" && onlyAddsToTarget(fromFolder)
      ? "add"
      : args.action;

  const updatedIds: Id<"cards">[] = [];
  const failedIds: Id<"cards">[] = [];
  const folderLimitIds: Id<"cards">[] = [];
  for (const cardId of cardIds) {
    try {
      await applyFolderMembership(ctx, {
        action,
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
        (error.data as { code?: unknown } | undefined)?.code === "FOLDER_LIMIT"
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

export const addCardsToFolder = mutation({
  args: { folderId: v.id("folders"), cardIds: v.array(v.id("cards")) },
  returns: membershipResultValidator,
  handler: async (ctx, args) =>
    applyFolderMembershipToCards(ctx, {
      ...args,
      action: "add",
      userId: await requireSessionUserId(ctx),
    }),
});

export const removeCardsFromFolder = mutation({
  args: { folderId: v.id("folders"), cardIds: v.array(v.id("cards")) },
  returns: membershipResultValidator,
  handler: async (ctx, args) =>
    applyFolderMembershipToCards(ctx, {
      ...args,
      action: "remove",
      userId: await requireSessionUserId(ctx),
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
      userId: await requireSessionUserId(ctx),
    }),
});

export const setCardFolders = mutation({
  args: { cardId: v.id("cards"), folderIds: v.array(v.id("folders")) },
  returns: v.array(v.id("folders")),
  handler: async (ctx, args) =>
    setCardFoldersForUser(
      ctx,
      await requireSessionUserId(ctx),
      args.cardId,
      args.folderIds
    ),
});
