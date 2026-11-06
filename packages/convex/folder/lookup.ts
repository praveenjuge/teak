import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  explainInvalidSmartFolderQuery,
  FOLDER_ERROR_MESSAGES,
  folderNameKey,
} from "../shared/folders";
import { resolveQuickSearchCommand } from "../shared/search/constants";
import {
  parseSearchQuery,
  searchExpressionQualifiers,
} from "../shared/search/qualifiers";

/**
 * Finding a user's folder and checking a smart folder's search: what folder
 * edits (folders.ts) and folder rules (rules.ts) both need before they
 * write, kept here so neither imports the other for it.
 */

export const folderNotFound = () =>
  new ConvexError({
    code: "NOT_FOUND",
    message: FOLDER_ERROR_MESSAGES.NOT_FOUND,
  });

export const getFolderForUser = async (
  ctx: QueryCtx,
  userId: string,
  id: string
): Promise<Doc<"folders"> | null> => {
  const folderId = ctx.db.normalizeId("folders", id);
  if (!folderId) {
    return null;
  }
  const folder = await ctx.db.get("folders", folderId);
  if (!folder || folder.userId !== userId || folder.deletingAt !== undefined) {
    return null;
  }
  return folder;
};

export const requireFolderForUser = async (
  ctx: QueryCtx,
  userId: string,
  id: string
): Promise<Doc<"folders">> => {
  const folder = await getFolderForUser(ctx, userId, id);
  if (!folder) {
    throw folderNotFound();
  }
  return folder;
};

export const normalizeSmartFolderQuery = async (
  ctx: QueryCtx,
  userId: string,
  query: string
): Promise<string> => {
  const parsed = parseSearchQuery(query);
  const command =
    parsed.qualifiers.length === 0 &&
    parsed.phrases.length === 0 &&
    parsed.terms.length === 1 &&
    !parsed.expression
      ? resolveQuickSearchCommand(parsed.terms[0] ?? "")
      : null;
  if (command === "favorites") {
    return "is:fav";
  }
  if (command === "archive") {
    return "is:archived";
  }
  if (command === "trash") {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: FOLDER_ERROR_MESSAGES.SMART_FOLDER_TRASH,
    });
  }
  const invalid = explainInvalidSmartFolderQuery(parsed.canonical);
  if (invalid) {
    throw new ConvexError({ code: "INVALID_INPUT", message: invalid });
  }
  for (const qualifier of [
    ...parsed.qualifiers,
    ...searchExpressionQualifiers(parsed.expression),
  ]) {
    if (qualifier.key !== "folder") {
      continue;
    }
    const nameKey = folderNameKey(qualifier.value);
    let named: Doc<"folders"> | undefined;
    for await (const folder of ctx.db
      .query("folders")
      .withIndex("by_userId_and_nameKey", (q) =>
        q.eq("userId", userId).eq("nameKey", nameKey)
      )) {
      if (folder.deletingAt === undefined) {
        named = folder;
        break;
      }
    }
    if (!named) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `No folder named ${qualifier.value}`,
      });
    }
    if (named.kind === "smart") {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: FOLDER_ERROR_MESSAGES.SMART_FOLDER_IN_QUERY,
      });
    }
  }
  return parsed.canonical;
};
