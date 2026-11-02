import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createCardForUserHandler } from "../card/createCard";
import { findLiveCardByUrl } from "../card/findDuplicateCard";
import { readPinnedCards } from "../card/pins";
import {
  getOrCreateImportFolderIds,
  type ImportFolderCache,
} from "../folder/folders";
import { insertImportedHighlights } from "../highlight/highlights";
import { cardTypeValidator, colorValidator } from "../schema";
import type { TeakUserId } from "../securitySessions";
import { MAX_PINNED_CARDS } from "../shared/pins";

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
  /** A link's highlights in the source; never stored on the item. */
  highlights: v.optional(
    v.array(v.object({ quote: v.string(), note: v.optional(v.string()) }))
  ),
  colors: v.optional(v.array(colorValidator)),
  importedCreatedAt: v.optional(v.number()),
  // A Teak archive's `savedAt`, only when it is later than `createdAt`.
  importedSavedAt: v.optional(v.number()),
  importedCompletedAt: v.optional(v.number()),
  importedPinPosition: v.optional(v.number()),
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

export type ImportCardItem = {
  highlights?: Array<{ note?: string; quote: string }>;
} & Pick<
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
  | "importedPinPosition"
  | "importedSavedAt"
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
  return findLiveCardByUrl(ctx, userId, url);
}

export type ImportCardOutcome =
  | { kind: "created"; cardId: Id<"cards"> }
  | { kind: "duplicate" }
  | { kind: "error"; code?: string; message?: string; retryAt?: number };

/**
 * Pins a card from a Teak archive where the archive had it, while there's
 * room. Pins past the cap stay unpinned.
 */
async function restoreImportedPin(
  ctx: MutationCtx,
  userId: TeakUserId,
  cardId: Id<"cards">,
  pinPosition: number
) {
  const pins = await readPinnedCards(ctx, userId);
  if (pins.length < MAX_PINNED_CARDS) {
    await ctx.db.patch("cards", cardId, { pinPosition });
  }
}

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
    const { cardId } = await createCardForUserHandler(
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
          savedAt: item.importedSavedAt,
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
        // An import never moves a card already in Teak: duplicates are
        // skipped above, and a card made here keeps the archive's order.
        skipResave: true,
        source: "import",
      }
    );
    if (item.highlights?.length) {
      await insertImportedHighlights(
        ctx,
        { _id: cardId, userId },
        item.highlights
      );
    }
    if (item.importedPinPosition !== undefined && item.isArchived !== true) {
      await restoreImportedPin(ctx, userId, cardId, item.importedPinPosition);
    }
    return { kind: "created", cardId };
  } catch (error) {
    return { kind: "error", ...errorData(error) };
  }
}
