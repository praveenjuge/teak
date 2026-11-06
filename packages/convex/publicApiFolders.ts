import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { folderOwnerOperations, requireFolderForUser } from "./folder/folders";
import {
  applyFolderMembershipToCards,
  smartFolderMembership,
} from "./folder/membership";
import {
  folderRuleRunValidator,
  getFolderRuleRunForUser as readFolderRuleRun,
  undoFolderRuleRunForUser as undoFolderRuleRun,
} from "./folder/rules";
import { apiMutation, apiQuery } from "./ownerOperation";
import { requireTeakUserId } from "./securitySessions";

// The public API's folder functions: the app's folder operations for the
// credential's owner, and the card and rule-run changes only the API takes.
export const listFoldersForUser = apiQuery(folderOwnerOperations.list);
export const getFolderForUser = apiQuery(folderOwnerOperations.get);
export const createFolderForUser = apiMutation(folderOwnerOperations.create);
export const updateFolderForUser = apiMutation(folderOwnerOperations.update);
export const deleteFolderForUser = apiMutation(folderOwnerOperations.delete);

export const changeFolderCardsForUser = internalMutation({
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

export const getFolderRuleRunForUser = internalQuery({
  args: { userId: v.string(), folderId: v.string(), runId: v.string() },
  returns: folderRuleRunValidator,
  handler: async (ctx, args) => {
    const owner = await requireTeakUserId(ctx, args.userId);
    await requireFolderForUser(ctx, owner, args.folderId);
    return readFolderRuleRun(ctx, owner, args.folderId, args.runId);
  },
});

export const undoFolderRuleRunForUser = internalMutation({
  args: { userId: v.string(), folderId: v.string(), runId: v.string() },
  returns: folderRuleRunValidator,
  handler: async (ctx, args) => {
    const owner = await requireTeakUserId(ctx, args.userId);
    await requireFolderForUser(ctx, owner, args.folderId);
    return undoFolderRuleRun(ctx, owner, args.folderId, args.runId);
  },
});
