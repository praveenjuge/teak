import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  createFolderForUser,
  deleteFolderForUser,
  folderReturnValidator,
  getFolderForUser,
  listFoldersForUser,
  requireFolderForUser,
  toFolderSummary,
  updateFolderForUser,
} from "./folder/folders";
import {
  applyFolderMembershipToCards,
  smartFolderMembership,
} from "./folder/membership";
import { folderColorValidator } from "./schema";
import { requireTeakUserId } from "./securitySessions";

export const listFoldersForApi = internalQuery({
  args: { userId: v.string() },
  returns: v.array(folderReturnValidator),
  handler: async (ctx, args) =>
    listFoldersForUser(ctx, await requireTeakUserId(ctx, args.userId)),
});

export const getFolderForApi = internalQuery({
  args: { userId: v.string(), folderId: v.string() },
  returns: v.union(folderReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const folder = await getFolderForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.folderId
    );
    return folder ? toFolderSummary(folder) : null;
  },
});

export const createFolderForApi = internalMutation({
  args: {
    userId: v.string(),
    name: v.string(),
    color: v.optional(folderColorValidator),
    kind: v.optional(v.union(v.literal("manual"), v.literal("smart"))),
    query: v.optional(v.string()),
  },
  returns: folderReturnValidator,
  handler: async (ctx, { userId, ...args }) =>
    createFolderForUser(ctx, await requireTeakUserId(ctx, userId), args),
});

export const updateFolderForApi = internalMutation({
  args: {
    userId: v.string(),
    folderId: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.union(folderColorValidator, v.null())),
    query: v.optional(v.string()),
  },
  returns: folderReturnValidator,
  handler: async (ctx, { userId, ...args }) =>
    updateFolderForUser(ctx, await requireTeakUserId(ctx, userId), args),
});

export const deleteFolderForApi = internalMutation({
  args: { userId: v.string(), folderId: v.string() },
  returns: v.id("folders"),
  handler: async (ctx, args) =>
    deleteFolderForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.folderId
    ),
});

export const changeFolderCardsForApi = internalMutation({
  args: {
    userId: v.string(),
    folderId: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
    cardIds: v.array(v.string()),
  },
  returns: v.object({
    updatedIds: v.array(v.string()),
    failedIds: v.array(v.string()),
    folderLimitIds: v.array(v.string()),
  }),
  handler: async (ctx, { userId, cardIds, ...args }) => {
    const valid: Id<"cards">[] = [];
    const invalid: string[] = [];
    for (const id of cardIds) {
      const cardId = ctx.db.normalizeId("cards", id);
      if (cardId) {
        valid.push(cardId);
      } else {
        invalid.push(id);
      }
    }
    const owner = await requireTeakUserId(ctx, userId);
    if (valid.length === 0) {
      const folder = await requireFolderForUser(ctx, owner, args.folderId);
      if (folder.kind === "smart") {
        throw smartFolderMembership();
      }
      return { updatedIds: [], failedIds: invalid, folderLimitIds: [] };
    }
    const result = await applyFolderMembershipToCards(ctx, {
      ...args,
      cardIds: valid,
      userId: owner,
    });
    return { ...result, failedIds: [...result.failedIds, ...invalid] };
  },
});
