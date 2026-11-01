import { inferFileFormat } from "../shared/fileFormats";
import { urlKey } from "../shared/utils/urlKey";
import { MAX_IMPORT_FILE_BYTES } from "./constants";
import { validateImportCard } from "./validate";

export type ImportIndexItem = ReturnType<typeof normalizeIndexItem>;

export function normalizeIndexItem(
  raw: unknown,
  sourceIndex: number,
  entries: Map<string, { uncompressedSize: number }>,
  seenUrls: Set<string>
) {
  try {
    const card = validateImportCard(raw);
    // Two addresses for one page (`www.`, tracking parameters) count once.
    const seenKey = card.url ? (urlKey(card.url) ?? card.url) : undefined;
    if (seenKey && seenUrls.has(seenKey)) {
      return {
        sourceIndex,
        status: "skipped" as const,
        type: card.type,
        content: card.content,
        url: card.url,
        failureCode: "SOURCE_DUPLICATE",
        failureReason: "Duplicate URL in import file",
      };
    }
    if (card.file) {
      const entry = entries.get(card.file.path);
      if (!entry) {
        throw new Error(`Missing ZIP entry: ${card.file.path}`);
      }
      if (entry.uncompressedSize > MAX_IMPORT_FILE_BYTES) {
        throw new Error("File exceeds the 20 MiB limit");
      }
      if (
        card.file.fileSize !== undefined &&
        card.file.fileSize !== entry.uncompressedSize
      ) {
        throw new Error("File size does not match the archive entry");
      }
    }
    if (seenKey) {
      seenUrls.add(seenKey);
    }
    return {
      sourceIndex,
      status: "pending" as const,
      type: card.type,
      content: card.content,
      url: card.url,
      tags: card.tags,
      notes: card.notes,
      isFavorited: card.isFavorited,
      isArchived: card.isArchived,
      metadataTitle: card.metadataTitle,
      folders: card.folders,
      // Only a link with highlights carries them, so other imports pass
      // while the Worker runs ahead of Convex.
      ...(card.highlights ? { highlights: card.highlights } : {}),
      colors: card.colors,
      importedCreatedAt: card.createdAt,
      // Only a card saved again carries it. The Worker deploys before Convex
      // accepts the field, and no archive made before re-saves existed has
      // one, so those imports still pass in between.
      ...(card.savedAt !== undefined &&
      card.createdAt !== undefined &&
      card.savedAt > card.createdAt
        ? { importedSavedAt: card.savedAt }
        : {}),
      importedCompletedAt: card.completedAt,
      filePath: card.file?.path,
      fileName: card.file?.fileName,
      fileSize: card.file
        ? entries.get(card.file.path)?.uncompressedSize
        : undefined,
      mimeType: card.file?.mimeType,
      duration: card.file?.duration,
      width: card.file?.width,
      height: card.file?.height,
    };
  } catch (error) {
    const value = raw as Record<string, unknown> | null;
    return {
      sourceIndex,
      status: "failed" as const,
      type: "text" as const,
      content:
        typeof value?.content === "string"
          ? value.content.slice(0, 100_000)
          : `Item ${sourceIndex + 1}`,
      failureCode: "INVALID_ITEM",
      failureReason:
        error instanceof Error ? error.message : "Invalid import item",
    };
  }
}

const ACTIVE_IMPORT_FORMATS = new Set(["html", "svg"]);

export const importStoredContentType = (item: {
  fileName?: string | null;
  mimeType?: string | null;
}): string => {
  const format = inferFileFormat({
    fileName: item.fileName ?? "file",
    mimeType: item.mimeType,
  });
  if (!format) {
    return "application/octet-stream";
  }
  return ACTIVE_IMPORT_FORMATS.has(format.id)
    ? "text/plain; charset=utf-8"
    : format.mimeType;
};

export const importFileKey = (
  userKeyPrefix: string,
  jobId: string,
  itemId: string,
  fileName: string
): string => {
  const safe =
    fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) || "file";
  return `${userKeyPrefix}/import-${jobId}/${itemId}/file/${safe}`;
};

export const importReportKey = (userKeyPrefix: string, jobId: string) =>
  `${userKeyPrefix}/imports/${jobId}/error-report.txt`;

export const importStagedPartKey = (
  userKeyPrefix: string,
  jobId: string,
  part: number
) => `${userKeyPrefix}/imports/${jobId}/staged/${part}.json`;

export const importStagedPartKeys = (
  userKeyPrefix: string,
  jobId: string,
  stagedItems?: { parts: number }
): string[] =>
  Array.from({ length: stagedItems?.parts ?? 0 }, (_, index) =>
    importStagedPartKey(userKeyPrefix, jobId, index + 1)
  );
