import { inferFileFormat } from "../shared/fileFormats";
import { MAX_IMPORT_FILE_BYTES } from "./constants";
import { validateImportCard } from "./validate";

// The import workflow (Files Worker) turns each indexed source entry into an
// `importJobItems` row with these helpers. They are pure so the Worker can
// run them next to the source it reads.

export type ImportIndexItem = ReturnType<typeof normalizeIndexItem>;

export function normalizeIndexItem(
  raw: unknown,
  sourceIndex: number,
  entries: Map<string, { uncompressedSize: number }>,
  seenUrls: Set<string>
) {
  try {
    const card = validateImportCard(raw);
    if (card.url && seenUrls.has(card.url)) {
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
    if (card.url) {
      seenUrls.add(card.url);
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
      colors: card.colors,
      importedCreatedAt: card.createdAt,
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

/** Imported HTML and SVG are stored as text, so they never render inline. */
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

/**
 * Where an extracted archive file goes. Deterministic per item, so a retried
 * extraction overwrites rather than leaks. `userKeyPrefix` is the owner's
 * `buildR2UserPrefix`.
 */
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
