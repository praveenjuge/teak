import { parseBookmarksHtml } from "@teak/convex/import/bookmarks";
import { parseRaindropCsv } from "@teak/convex/import/raindrop";
import {
  decodeMarkdownUtf8,
  MARKDOWN_CONTENT_MAX_BYTES,
  MarkdownContentError,
} from "@teak/convex/shared/markdown";
import {
  FILES_IMPORT_PAGE_BYTES,
  FILES_IMPORT_PAGE_ITEMS,
  type FilesImportIndexParams,
  type FilesImportIndexResult,
  type FilesImportMarkdownParams,
  type FilesImportMarkdownResult,
} from "@teak/files-protocol";
import { readImportJson } from "./importJson";
import { isValidUploadKey } from "./upload";
import {
  ArchiveEntryTooLargeError,
  readZipDirectory,
  readZipEntry,
} from "./zip";

export async function indexImportSource(
  bucket: R2Bucket,
  input: unknown
): Promise<FilesImportIndexResult> {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_import_params");
  }
  const params = input as FilesImportIndexParams;
  const { sourceKey, mode, expectedSize, sourceEtag } = params;
  const cursor = params.cursor ?? 0;
  if (
    !(
      typeof sourceKey === "string" &&
      isValidUploadKey(sourceKey) &&
      ["archive", "bookmarks", "raindrop"].includes(mode) &&
      Number.isSafeInteger(expectedSize)
    ) ||
    expectedSize < 0 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > 10_000 ||
    (cursor > 0 && !sourceEtag) ||
    (sourceEtag !== undefined &&
      (typeof sourceEtag !== "string" || sourceEtag.length > 255))
  ) {
    throw new Error("invalid_import_params");
  }
  const meta = await bucket.head(sourceKey);
  if (!meta) {
    throw new Error("source_not_found");
  }
  if (
    meta.size !== expectedSize ||
    (sourceEtag && sourceEtag !== meta.httpEtag)
  ) {
    throw new Error("source_changed");
  }
  if (mode === "archive") {
    const directory = await readZipDirectory(bucket, sourceKey, meta.httpEtag);
    const manifestEntry = directory.entries.find(
      (entry) => entry.name === "manifest.json"
    );
    if (!manifestEntry) {
      throw new Error("invalid_archive_missing_manifest");
    }
    let page = await readImportJson(
      bucket,
      sourceKey,
      directory,
      manifestEntry,
      cursor
    );
    if (page.version !== 1) {
      throw new Error("invalid_archive_version");
    }
    if (!page.hasCards) {
      const cardsEntry = directory.entries.find(
        (entry) => entry.name === "cards.json"
      );
      if (!cardsEntry) {
        throw new Error("invalid_archive_missing_cards");
      }
      page = await readImportJson(
        bucket,
        sourceKey,
        directory,
        cardsEntry,
        cursor
      );
      if (!page.hasCards) {
        throw new Error("invalid_archive_missing_cards");
      }
    }
    return {
      items: page.items,
      total: page.total,
      nextCursor:
        cursor + page.items.length < page.total
          ? cursor + page.items.length
          : null,
      sourceEtag: meta.httpEtag,
    };
  }
  if (meta.size > 20 * 1024 * 1024) {
    throw new Error("source_too_large");
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new Error("source_not_found");
  }
  if (object.httpEtag !== meta.httpEtag) {
    await object.body.cancel();
    throw new Error("source_changed");
  }
  const text = await object.text();
  let parsed: ReturnType<typeof parseBookmarksHtml>;
  try {
    parsed =
      mode === "raindrop" ? parseRaindropCsv(text) : parseBookmarksHtml(text);
  } catch (error) {
    throw new Error("invalid_bookmark_source", { cause: error });
  }
  if (parsed.length > 10_000) {
    throw new Error("invalid_bookmark_count");
  }
  const items: FilesImportIndexResult["items"] = [];
  let bytes = 0;
  for (
    let i = cursor;
    i < parsed.length && items.length < FILES_IMPORT_PAGE_ITEMS;
    i++
  ) {
    let item = { ...parsed[i], sourceIndex: i };
    let size = new TextEncoder().encode(JSON.stringify(item)).length;
    if (size > FILES_IMPORT_PAGE_BYTES) {
      item = {
        label: item.label.slice(0, 100_000),
        error: "Import item is too large",
        sourceIndex: i,
      };
      size = new TextEncoder().encode(JSON.stringify(item)).length;
    }
    if (items.length && bytes + size > FILES_IMPORT_PAGE_BYTES) {
      break;
    }
    items.push(item);
    bytes += size;
  }
  return {
    items,
    total: parsed.length,
    nextCursor:
      cursor + items.length < parsed.length ? cursor + items.length : null,
    sourceEtag: meta.httpEtag,
  };
}
export async function readImportMarkdown(
  bucket: R2Bucket,
  input: unknown
): Promise<FilesImportMarkdownResult> {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_markdown_params");
  }
  const params = input as FilesImportMarkdownParams;
  if (
    typeof params.sourceKey !== "string" ||
    !isValidUploadKey(params.sourceKey) ||
    typeof params.path !== "string" ||
    typeof params.sourceEtag !== "string" ||
    !params.sourceEtag ||
    params.sourceEtag.length > 255
  ) {
    throw new Error("invalid_markdown_params");
  }
  const directory = await readZipDirectory(
    bucket,
    params.sourceKey,
    params.sourceEtag
  );
  const entry = directory.entries.find((item) => item.name === params.path);
  if (!entry) {
    throw new Error("invalid_archive_entry");
  }
  try {
    const bytes = await readZipEntry(
      bucket,
      params.sourceKey,
      directory,
      entry,
      MARKDOWN_CONTENT_MAX_BYTES,
      Number.POSITIVE_INFINITY
    );
    return { content: decodeMarkdownUtf8(bytes), type: "text" };
  } catch (error) {
    if (error instanceof MarkdownContentError) {
      return {
        status: "failed",
        failureCode: error.code,
        failureReason: error.message,
      };
    }
    if (error instanceof ArchiveEntryTooLargeError) {
      return {
        status: "failed",
        failureCode: "CONTENT_TOO_LARGE",
        failureReason: error.message,
      };
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("invalid_archive") ||
        error.message === "archive_parse_failed")
    ) {
      return {
        status: "failed",
        failureCode: "INVALID_ITEM",
        failureReason: error.message,
      };
    }
    throw error;
  }
}
