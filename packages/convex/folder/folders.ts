import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { folderColorValidator } from "../schema";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  type FolderColor,
  folderNameKey,
  MAX_FOLDERS_PER_USER,
  normalizeFolderName,
} from "../shared/folders";

/** Cards one deletion batch detaches before it schedules the next. */
export const FOLDER_DELETE_BATCH_SIZE = 50;
/**
 * How long a deleted folder can be restored. Its cards are only detached
 * after this, so Undo brings the folder back exactly as it was.
 */
export const FOLDER_DELETE_UNDO_MS = 10_000;

export const folderReturnValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  color: v.optional(folderColorValidator),
  kind: v.union(v.literal("manual"), v.literal("smart")),
  activeCardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export interface FolderSummary {
  _id: Id<"folders">;
  activeCardCount: number;
  color?: FolderColor;
  createdAt: number;
  kind: "manual" | "smart";
  name: string;
  updatedAt: number;
}

export const toFolderSummary = (folder: Doc<"folders">): FolderSummary => ({
  _id: folder._id,
  name: folder.name,
  ...(folder.color ? { color: folder.color } : {}),
  kind: folder.kind,
  activeCardCount: folder.activeCardCount,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const folderNotFound = () =>
  new ConvexError({
    code: "NOT_FOUND",
    message: FOLDER_ERROR_MESSAGES.NOT_FOUND,
  });

const requireSignedIn = async (ctx: QueryCtx | MutationCtx) => {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Sign in to manage folders",
    });
  }
  return user.teakUserId;
};

/**
 * The user's folder by id, or null when it is missing, another user's, or
 * being deleted. `id` may be any string: one that is not a folder id is null.
 */
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

/** The user's folder, or a NOT_FOUND error. */
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

/** Every folder the user has, sorted by name. */
export const listFoldersForUser = async (
  ctx: QueryCtx,
  userId: string
): Promise<FolderSummary[]> => {
  const folders = await ctx.db
    .query("folders")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
    .take(MAX_FOLDERS_PER_USER + 1);
  return folders
    .filter((folder) => folder.deletingAt === undefined)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.createdAt - b.createdAt
    )
    .map(toFolderSummary);
};

const assertValidName = (name: string) => {
  const reason = explainInvalidFolderName(name);
  if (reason) {
    throw new ConvexError({ code: "INVALID_INPUT", message: reason });
  }
};

const assertNameAvailable = async (
  ctx: MutationCtx,
  userId: string,
  name: string,
  exceptId?: Id<"folders">
) => {
  const nameKey = folderNameKey(name);
  const sameName = await ctx.db
    .query("folders")
    .withIndex("by_userId_and_nameKey", (q) =>
      q.eq("userId", userId).eq("nameKey", nameKey)
    )
    .take(2);
  if (
    sameName.some(
      (folder) => folder._id !== exceptId && folder.deletingAt === undefined
    )
  ) {
    throw new ConvexError({
      code: "CONFLICT",
      message: FOLDER_ERROR_MESSAGES.DUPLICATE_NAME,
    });
  }
};

export const createFolderForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: { color?: FolderColor; name: string }
): Promise<FolderSummary> => {
  assertValidName(args.name);
  const name = normalizeFolderName(args.name);
  await assertNameAvailable(ctx, userId, name);
  // Folders being deleted still count until their row is gone.
  const existing = await ctx.db
    .query("folders")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
    .take(MAX_FOLDERS_PER_USER);
  if (existing.length >= MAX_FOLDERS_PER_USER) {
    throw new ConvexError({
      code: "LIMIT_REACHED",
      message: FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS,
    });
  }
  const now = Date.now();
  const folderId = await ctx.db.insert("folders", {
    userId,
    name,
    nameKey: folderNameKey(name),
    ...(args.color ? { color: args.color } : {}),
    kind: "manual",
    activeCardCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const folder = await ctx.db.get("folders", folderId);
  if (!folder) {
    throw new Error("Failed to create folder");
  }
  return toFolderSummary(folder);
};

export const updateFolderForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: {
    /** A palette color, or null to clear it. Undefined leaves it as is. */
    color?: FolderColor | null;
    folderId: string;
    name?: string;
  }
): Promise<FolderSummary> => {
  const folder = await requireFolderForUser(ctx, userId, args.folderId);
  const patch: Partial<Doc<"folders">> = {};
  if (args.name !== undefined) {
    assertValidName(args.name);
    const name = normalizeFolderName(args.name);
    if (name !== folder.name) {
      if (folderNameKey(name) !== folder.nameKey) {
        await assertNameAvailable(ctx, userId, name, folder._id);
      }
      patch.name = name;
      patch.nameKey = folderNameKey(name);
    }
  }
  if (args.color !== undefined && (args.color ?? undefined) !== folder.color) {
    patch.color = args.color ?? undefined;
  }
  if (Object.keys(patch).length === 0) {
    return toFolderSummary(folder);
  }
  await ctx.db.patch("folders", folder._id, {
    ...patch,
    updatedAt: Date.now(),
  });
  const updated = await ctx.db.get("folders", folder._id);
  if (!updated) {
    throw folderNotFound();
  }
  return toFolderSummary(updated);
};

/**
 * Hides the folder at once. After FOLDER_DELETE_UNDO_MS its cards are
 * detached in batches: each takes the folder off up to
 * FOLDER_DELETE_BATCH_SIZE cards (their folder rows follow through the card
 * sync), and the last one removes the folder.
 */
export const deleteFolderForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  folderId: string
): Promise<Id<"folders">> => {
  const folder = await requireFolderForUser(ctx, userId, folderId);
  await ctx.db.patch("folders", folder._id, { deletingAt: Date.now() });
  await ctx.scheduler.runAfter(
    FOLDER_DELETE_UNDO_MS,
    internal.folder.folders.deleteFolderBatch,
    { folderId: folder._id }
  );
  return folder._id;
};

/**
 * Brings back a folder deleted less than FOLDER_DELETE_UNDO_MS ago, before
 * any of its cards were detached. Fails if the window has passed or another
 * folder took its name meanwhile.
 */
export const restoreFolderForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  id: string
): Promise<FolderSummary> => {
  const folderId = ctx.db.normalizeId("folders", id);
  const folder = folderId ? await ctx.db.get("folders", folderId) : null;
  if (!folder || folder.userId !== userId) {
    throw folderNotFound();
  }
  if (folder.deletingAt === undefined) {
    return toFolderSummary(folder);
  }
  if (Date.now() >= folder.deletingAt + FOLDER_DELETE_UNDO_MS) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "This folder can no longer be restored",
    });
  }
  await assertNameAvailable(ctx, userId, folder.name, folder._id);
  await ctx.db.patch("folders", folder._id, { deletingAt: undefined });
  return toFolderSummary({ ...folder, deletingAt: undefined });
};

export const deleteFolderBatchHandler = async (
  ctx: MutationCtx,
  folderId: Id<"folders">
): Promise<{ done: boolean }> => {
  const folder = await ctx.db.get("folders", folderId);
  // Restored (Undo) before the batch ran: nothing to do.
  if (!folder || folder.deletingAt === undefined) {
    return { done: true };
  }
  // Account deletion removes every folder and folder row itself; card
  // writes stand down meanwhile, so a batch here would never finish.
  if (await getAccountDeletionState(ctx, folder.userId)) {
    return { done: true };
  }
  const rows = await ctx.db
    .query("folderCards")
    .withIndex("by_folder_deleted_archived_created", (q) =>
      q.eq("folderId", folderId)
    )
    .take(FOLDER_DELETE_BATCH_SIZE);
  const now = Date.now();
  for (const row of rows) {
    const card = await ctx.db.get("cards", row.cardId);
    const remaining = (card?.folderIds ?? []).filter((id) => id !== folderId);
    if (card && remaining.length !== (card.folderIds ?? []).length) {
      // The card sync removes this folder's row for the card.
      await patchCardWithSearchSync(ctx, card._id, {
        folderIds: remaining.length > 0 ? remaining : undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.delete("folderCards", row._id);
    }
  }
  if (rows.length === FOLDER_DELETE_BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.folder.folders.deleteFolderBatch, {
      folderId,
    });
    return { done: false };
  }
  await ctx.db.delete("folders", folderId);
  return { done: true };
};

export const deleteFolderBatch = internalMutation({
  args: { folderId: v.id("folders") },
  returns: v.object({ done: v.boolean() }),
  handler: (ctx, { folderId }) => deleteFolderBatchHandler(ctx, folderId),
});

export const listFolders = query({
  args: {},
  returns: v.array(folderReturnValidator),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    return listFoldersForUser(ctx, user.teakUserId);
  },
});

export const getFolder = query({
  args: { folderId: v.string() },
  returns: v.union(folderReturnValidator, v.null()),
  handler: async (ctx, { folderId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const folder = await getFolderForUser(ctx, user.teakUserId, folderId);
    return folder ? toFolderSummary(folder) : null;
  },
});

export const createFolder = mutation({
  args: {
    name: v.string(),
    color: v.optional(folderColorValidator),
  },
  returns: folderReturnValidator,
  handler: async (ctx, args) =>
    createFolderForUser(ctx, await requireSignedIn(ctx), args),
});

export const updateFolder = mutation({
  args: {
    folderId: v.id("folders"),
    name: v.optional(v.string()),
    color: v.optional(v.union(folderColorValidator, v.null())),
  },
  returns: folderReturnValidator,
  handler: async (ctx, args) =>
    updateFolderForUser(ctx, await requireSignedIn(ctx), args),
});

export const deleteFolder = mutation({
  args: { folderId: v.id("folders") },
  returns: v.id("folders"),
  handler: async (ctx, { folderId }) =>
    deleteFolderForUser(ctx, await requireSignedIn(ctx), folderId),
});

export const restoreFolder = mutation({
  args: { folderId: v.id("folders") },
  returns: folderReturnValidator,
  handler: async (ctx, { folderId }) =>
    restoreFolderForUser(ctx, await requireSignedIn(ctx), folderId),
});
