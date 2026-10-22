import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createCardForUserHandler } from "../card/createCard";
import {
  getOrCreateImportFolderIds,
  type ImportFolderCache,
} from "../folder/folders";
import { cardTypeValidator, colorValidator } from "../schema";
import type { TeakUserId } from "../securitySessions";

/** The fields of one import item, as the Workflow read it from the source. */
export const importItemFields = {
  sourceIndex: v.number(),
  type: cardTypeValidator,
  content: v.string(),
  url: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isArchived: v.optional(v.boolean()),
  metadataTitle: v.optional(v.string()),
  folders: v.optional(v.array(v.string())),
  colors: v.optional(v.array(colorValidator)),
  importedCreatedAt: v.optional(v.number()),
  importedCompletedAt: v.optional(v.number()),
  filePath: v.optional(v.string()),
  fileName: v.optional(v.string()),
  fileSize: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  duration: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  failureCode: v.optional(v.string()),
  failureReason: v.optional(v.string()),
};

export type ImportCardItem = Pick<
  Doc<"importJobItems">,
  | "colors"
  | "content"
  | "duration"
  | "extractedFileKey"
  | "fileName"
  | "fileSize"
  | "folders"
  | "height"
  | "importedCompletedAt"
  | "importedCreatedAt"
  | "isArchived"
  | "isFavorited"
  | "metadataTitle"
  | "mimeType"
  | "notes"
  | "tags"
  | "type"
  | "url"
  | "width"
>;

export function importedBookmarkTitle(
  mode: Doc<"importJobs">["mode"],
  item: Pick<
    Doc<"importJobItems">,
    "content" | "metadataTitle" | "type" | "url"
  >
): string | undefined {
  if (mode === "archive") {
    return item.metadataTitle;
  }
  if (item.type !== "link" || !item.url) {
    return;
  }
  const title = item.content.trim();
  return title && title !== item.url ? title : undefined;
}

function errorData(error: unknown) {
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === "object"
  ) {
    return error.data as { code?: string; message?: string; retryAt?: number };
  }
  return { message: error instanceof Error ? error.message : "Import failed" };
}

function existingUrl(ctx: MutationCtx, userId: string, url: string) {
  return ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
    )
    .first();
}

export type ImportCardOutcome =
  | { kind: "created"; cardId: Id<"cards"> }
  | { kind: "duplicate" }
  | { kind: "error"; code?: string; message?: string; retryAt?: number };

/** Creates one imported card, or says why it can't. */
export async function createImportedCard(
  ctx: MutationCtx,
  job: Doc<"importJobs">,
  userId: TeakUserId,
  item: ImportCardItem,
  folderCache: ImportFolderCache
): Promise<ImportCardOutcome> {
  if (item.url && (await existingUrl(ctx, job.userId, item.url))) {
    return { kind: "duplicate" };
  }
  try {
    const cardId = await createCardForUserHandler(
      ctx,
      userId,
      {
        type: item.type,
        content: item.content,
        url: item.url,
        tags: item.tags,
        notes: item.notes,
        colors: item.colors,
        fileKey: item.extractedFileKey,
        metadata: item.extractedFileKey
          ? {
              fileName: item.fileName,
              fileSize: item.fileSize,
              mimeType: item.mimeType,
              duration: item.duration,
              width: item.width,
              height: item.height,
            }
          : undefined,
      },
      {
        importedVisibleFields: {
          createdAt: item.importedCreatedAt,
          completedAt: item.importedCompletedAt,
          isFavorited: item.isFavorited,
          isArchived: item.isArchived === true,
          metadataTitle: importedBookmarkTitle(job.mode, item),
        },
        resolveFolderIds: item.folders?.length
          ? () =>
              getOrCreateImportFolderIds(
                ctx,
                job.userId,
                item.folders ?? [],
                folderCache
              )
          : undefined,
        source: "import",
      }
    );
    return { kind: "created", cardId };
  } catch (error) {
    return { kind: "error", ...errorData(error) };
  }
}
