// Folder operations for the public API, MCP and SDK: internal functions keyed
// by the authorized user, wrapping the same handlers the app uses.
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
import { applyFolderMembershipToCards } from "./folder/membership";
import { folderColorValidator } from "./schema";
import { requireTeakUserId } from "./securitySessions";

export const listFoldersForApi = internalQuery({
  args: { userId: v.string() },
  returns: v.array(folderReturnValidator),
  handler: async (ctx, args) =>
    listFoldersForUser(ctx, await requireTeakUserId(ctx, args.userId)),
});

/** The user's folder for an id from a URL, or null when it is not theirs. */
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

/**
 * Adds or removes cards. Ids that are not card ids fail like missing cards,
 * so one bad id never fails the whole call.
 */
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
      // Still check the folder, so a bad folder id reports NOT_FOUND.
      await requireFolderForUser(ctx, owner, args.folderId);
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
