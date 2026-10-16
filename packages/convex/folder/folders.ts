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
import { accountDeletionOwnsRows } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { folderColorValidator } from "../schema";
import { getSessionUser, type TeakUserId } from "../securitySessions";
import {
  explainInvalidFolderName,
  explainInvalidSmartFolderQuery,
  FOLDER_ERROR_MESSAGES,
  type FolderColor,
  type FolderKind,
  folderNameKey,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  normalizeFolderName,
} from "../shared/folders";
import { resolveQuickSearchCommand } from "../shared/search/constants";
import {
  parseSearchQuery,
  renameFolderInSearchQuery,
} from "../shared/search/qualifiers";

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
  /** A smart folder's search, written the canonical way. */
  query: v.optional(v.string()),
  activeCardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export interface FolderSummary {
  _id: Id<"folders">;
  activeCardCount: number;
  color?: FolderColor;
  createdAt: number;
  kind: FolderKind;
  name: string;
  query?: string;
  updatedAt: number;
}

export const toFolderSummary = (folder: Doc<"folders">): FolderSummary => ({
  _id: folder._id,
  name: folder.name,
  ...(folder.color ? { color: folder.color } : {}),
  kind: folder.kind,
  ...(folder.kind === "smart" ? { query: folder.query ?? "" } : {}),
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
    .take(MAX_FOLDERS_PER_USER);
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

/**
 * Inserts an empty folder, manual unless a smart folder's `query` is given;
 * callers check the name, the query and the cap.
 */
export const insertFolder = (
  ctx: MutationCtx,
  userId: string,
  name: string,
  color?: FolderColor,
  now = Date.now(),
  query?: string
): Promise<Id<"folders">> =>
  ctx.db.insert("folders", {
    userId,
    name,
    nameKey: folderNameKey(name),
    ...(color ? { color } : {}),
    ...(query === undefined
      ? { kind: "manual" as const }
      : { kind: "smart" as const, query }),
    activeCardCount: 0,
    createdAt: now,
    updatedAt: now,
  });

/**
 * Folder lookups remembered across the cards of one import batch: name key
 * to folder id (null when the name can't be used), and the user's folder
 * count once read.
 */
export interface ImportFolderCache {
  count?: number;
  ids: Map<string, Id<"folders"> | null>;
}

export const newImportFolderCache = (): ImportFolderCache => ({
  ids: new Map(),
});

/**
 * The user's manual folders with these names, creating the missing ones, for
 * cards made by an import. Names match ignoring case, so a later batch of the
 * same import (or a second import) reuses the folder. A name that is invalid,
 * belongs to a smart folder, or would pass the folder cap is skipped: the
 * card is still imported, just without that folder.
 */
export const getOrCreateImportFolderIds = async (
  ctx: MutationCtx,
  userId: string,
  names: readonly string[],
  cache: ImportFolderCache
): Promise<Id<"folders">[]> => {
  const ids: Id<"folders">[] = [];
  for (const raw of names) {
    if (explainInvalidFolderName(raw)) {
      continue;
    }
    const name = normalizeFolderName(raw);
    const nameKey = folderNameKey(name);
    let id = cache.ids.get(nameKey);
    if (id === undefined) {
      id = null;
      let existing: Doc<"folders"> | undefined;
      for await (const folder of ctx.db
        .query("folders")
        .withIndex("by_userId_and_nameKey", (q) =>
          q.eq("userId", userId).eq("nameKey", nameKey)
        )) {
        if (folder.deletingAt === undefined) {
          existing = folder;
          break;
        }
      }
      if (existing) {
        id = existing.kind === "manual" ? existing._id : null;
      } else {
        cache.count ??= (
          await ctx.db
            .query("folders")
            .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
            .take(MAX_FOLDERS_PER_USER)
        ).length;
        if (cache.count < MAX_FOLDERS_PER_USER) {
          id = await insertFolder(ctx, userId, name);
          cache.count += 1;
        }
      }
      cache.ids.set(nameKey, id);
    }
    if (id !== null && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.slice(0, MAX_FOLDERS_PER_CARD);
};

/**
 * A smart folder's search as stored (canonical), or an INVALID_INPUT error:
 * empty, too long, or a `folder:` that is not one of the user's manual
 * folders. A smart folder's cards come from its search, so `folder:` naming
 * another smart folder would never match.
 */
export const normalizeSmartFolderQuery = async (
  ctx: QueryCtx,
  userId: string,
  query: string
): Promise<string> => {
  const parsed = parseSearchQuery(query);
  const command =
    parsed.qualifiers.length === 0 &&
    parsed.phrases.length === 0 &&
    parsed.terms.length === 1
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
  for (const qualifier of parsed.qualifiers) {
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

export const createFolderForUser = async (
  ctx: MutationCtx,
  userId: TeakUserId,
  args: {
    color?: FolderColor;
    /** "smart" needs a `query`; manual folders take none. */
    kind?: FolderKind;
    name: string;
    query?: string;
  }
): Promise<FolderSummary> => {
  assertValidName(args.name);
  const name = normalizeFolderName(args.name);
  const kind = args.kind ?? (args.query === undefined ? "manual" : "smart");
  if (kind === "manual" && args.query !== undefined) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: FOLDER_ERROR_MESSAGES.QUERY_ON_MANUAL_FOLDER,
    });
  }
  const query =
    kind === "smart"
      ? await normalizeSmartFolderQuery(ctx, userId, args.query ?? "")
      : undefined;
  await assertNameAvailable(ctx, userId, name);
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
  const folderId = await insertFolder(
    ctx,
    userId,
    name,
    args.color,
    Date.now(),
    query
  );
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
    /** A smart folder's new search; manual folders refuse one. */
    query?: string;
  }
): Promise<FolderSummary> => {
  const folder = await requireFolderForUser(ctx, userId, args.folderId);
  const patch: Partial<Doc<"folders">> = {};
  if (args.query !== undefined) {
    if (folder.kind !== "smart") {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: FOLDER_ERROR_MESSAGES.QUERY_ON_MANUAL_FOLDER,
      });
    }
    if (parseSearchQuery(args.query).canonical !== folder.query) {
      patch.query = await normalizeSmartFolderQuery(ctx, userId, args.query);
    }
  }
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
  const now = Date.now();
  await ctx.db.patch("folders", folder._id, { ...patch, updatedAt: now });
  if (
    folder.kind === "manual" &&
    patch.nameKey !== undefined &&
    patch.name !== undefined
  ) {
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(MAX_FOLDERS_PER_USER);
    for (const other of folders) {
      if (other.kind !== "smart" || other.query === undefined) {
        continue;
      }
      const query = renameFolderInSearchQuery(
        other.query,
        folder.nameKey,
        patch.name
      );
      if (query !== other.query) {
        await ctx.db.patch("folders", other._id, { query, updatedAt: now });
      }
    }
  }
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
  const deletingAt = Date.now();
  await ctx.db.patch("folders", folder._id, { deletingAt });
  // The batch carries this delete's time, so a batch left over from an
  // earlier delete that was undone stands down instead of cutting this
  // delete's Undo window short.
  await ctx.scheduler.runAfter(
    FOLDER_DELETE_UNDO_MS,
    internal.folder.folders.deleteFolderBatch,
    { folderId: folder._id, deletingAt }
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
  folderId: Id<"folders">,
  deletingAt?: number
): Promise<{ done: boolean }> => {
  const folder = await ctx.db.get("folders", folderId);
  if (
    !folder ||
    folder.deletingAt === undefined ||
    (deletingAt !== undefined && folder.deletingAt !== deletingAt)
  ) {
    return { done: true };
  }
  if (await accountDeletionOwnsRows(ctx, folder.userId)) {
    return { done: true };
  }
  const rows = await ctx.db
    .query("folderCards")
    .withIndex(
      "by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt",
      (q) => q.eq("folderId", folderId)
    )
    .take(FOLDER_DELETE_BATCH_SIZE);
  const now = Date.now();
  for (const row of rows) {
    const card = await ctx.db.get("cards", row.cardId);
    const remaining = (card?.folderIds ?? []).filter((id) => id !== folderId);
    if (card && remaining.length !== (card.folderIds ?? []).length) {
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
      deletingAt: folder.deletingAt,
    });
    return { done: false };
  }
  await ctx.db.delete("folders", folderId);
  return { done: true };
};

export const deleteFolderBatch = internalMutation({
  // deletingAt is optional so batches scheduled before it existed still run.
  args: { folderId: v.id("folders"), deletingAt: v.optional(v.number()) },
  returns: v.object({ done: v.boolean() }),
  handler: (ctx, { folderId, deletingAt }) =>
    deleteFolderBatchHandler(ctx, folderId, deletingAt),
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
    kind: v.optional(v.union(v.literal("manual"), v.literal("smart"))),
    query: v.optional(v.string()),
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
    query: v.optional(v.string()),
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
