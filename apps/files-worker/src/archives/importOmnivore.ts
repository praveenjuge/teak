import {
  OMNIVORE_METADATA_PATTERN,
  type OmnivoreItem,
  omnivoreHighlightsPath,
  omnivoreItem,
  readOmnivoreMetadata,
} from "@teak/convex/import/omnivore";
import { MAX_NOTES_LENGTH } from "@teak/convex/import/sourceItems";
import {
  FILES_IMPORT_PAGE_BYTES,
  FILES_IMPORT_PAGE_ITEMS,
  type FilesImportIndexResult,
} from "@teak/files-protocol";
import {
  rangeRead,
  readZipDirectory,
  readZipEntry,
  type ZipCentralEntry,
  type ZipDirectory,
} from "./zip";

const MAX_ITEMS = 10_000;
const METADATA_LIMIT = 8 * 1024 * 1024;
const UTF8_MAX_BYTES_PER_CHARACTER = 4;
const HIGHLIGHTS_LIMIT = MAX_NOTES_LENGTH * UTF8_MAX_BYTES_PER_CHARACTER;
const PARALLEL_READS = 12;

export async function isZipSource(
  bucket: R2Bucket,
  key: string,
  etag: string
): Promise<boolean> {
  const head = await rangeRead(bucket, key, 0, 2, etag).catch(() => null);
  return head !== null && head[0] === 0x50 && head[1] === 0x4b;
}

interface MetadataFile {
  end: number;
  entry: ZipCentralEntry;
  prefix: string;
  start: number;
}

const decode = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);

async function inBatches<T, R>(
  values: T[],
  read: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += PARALLEL_READS) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + PARALLEL_READS).map(read)
      ))
    );
  }
  return results;
}

/**
 * Pages through an Omnivore export ZIP. Omnivore names each metadata file by
 * the items it holds, `metadata_<start>_to_<end>.json` (end exclusive), so a
 * page reads only the files it overlaps; when the names don't chain from 0
 * every file is read to place the items. Each item's
 * `highlights/<slug>.md`, beside its metadata file (the ZIP may wrap the
 * export in a folder), becomes its note.
 */
export async function indexOmnivoreZip(
  bucket: R2Bucket,
  key: string,
  etag: string,
  cursor: number
): Promise<FilesImportIndexResult> {
  const directory: ZipDirectory = await readZipDirectory(bucket, key, etag);
  const entries = new Map(
    directory.entries.map((entry) => [entry.name, entry])
  );
  const files: MetadataFile[] = [];
  for (const entry of directory.entries) {
    const match = OMNIVORE_METADATA_PATTERN.exec(entry.name);
    if (match) {
      files.push({
        entry,
        start: Number(match[1]),
        end: Number(match[2]),
        prefix: entry.name.slice(0, entry.name.lastIndexOf("/") + 1),
      });
    }
  }
  if (files.length === 0) {
    throw new Error("invalid_import_source");
  }
  files.sort((a, b) => a.start - b.start);
  const chained = files.every(
    (file, index) =>
      file.end > file.start &&
      file.start === (index === 0 ? 0 : files[index - 1]?.end)
  );
  const readFile = async (file: MetadataFile) => {
    try {
      return readOmnivoreMetadata(
        decode(
          await readZipEntry(bucket, key, directory, file.entry, METADATA_LIMIT)
        )
      );
    } catch {
      throw new Error("invalid_import_source");
    }
  };

  let total: number;
  let pageItems: Array<{ index: number; item: OmnivoreItem; prefix: string }> =
    [];
  const pageEnd = cursor + FILES_IMPORT_PAGE_ITEMS;
  if (chained) {
    total = files.at(-1)?.end ?? 0;
    if (total > MAX_ITEMS) {
      throw new Error("invalid_bookmark_count");
    }
    const needed = files.filter(
      (file) => file.end > cursor && file.start < pageEnd
    );
    const lists = await inBatches(needed, readFile);
    needed.forEach((file, fileIndex) => {
      const list = lists[fileIndex] ?? [];
      if (list.length !== file.end - file.start) {
        throw new Error("invalid_import_source");
      }
      list.forEach((item, offset) => {
        pageItems.push({
          index: file.start + offset,
          item,
          prefix: file.prefix,
        });
      });
    });
  } else {
    const lists = await inBatches(files, readFile);
    const all = files.flatMap((file, fileIndex) =>
      (lists[fileIndex] ?? []).map((item) => ({ item, prefix: file.prefix }))
    );
    total = all.length;
    if (total > MAX_ITEMS) {
      throw new Error("invalid_bookmark_count");
    }
    pageItems = all.map((entry, index) => ({ index, ...entry }));
  }
  pageItems = pageItems.filter(
    ({ index }) => index >= cursor && index < pageEnd
  );

  const highlights = await inBatches(pageItems, async ({ item, prefix }) => {
    const entry =
      typeof item.slug === "string"
        ? entries.get(`${prefix}${omnivoreHighlightsPath(item.slug)}`)
        : undefined;
    if (!entry || entry.uncompressedSize > HIGHLIGHTS_LIMIT) {
      return;
    }
    return await readZipEntry(
      bucket,
      key,
      directory,
      entry,
      HIGHLIGHTS_LIMIT
    ).then(decode, () => undefined);
  });

  const items: FilesImportIndexResult["items"] = [];
  let bytes = 0;
  for (const [position, { index, item }] of pageItems.entries()) {
    let parsed = {
      ...omnivoreItem(item, highlights[position]),
      sourceIndex: index,
    };
    let size = new TextEncoder().encode(JSON.stringify(parsed)).length;
    if (size > FILES_IMPORT_PAGE_BYTES) {
      parsed = {
        label: parsed.label.slice(0, 100_000),
        error: "Import item is too large",
        sourceIndex: index,
      };
      size = new TextEncoder().encode(JSON.stringify(parsed)).length;
    }
    if (items.length && bytes + size > FILES_IMPORT_PAGE_BYTES) {
      break;
    }
    items.push(parsed);
    bytes += size;
  }
  const next = cursor + items.length;
  return {
    items,
    total,
    nextCursor: next < total ? next : null,
    sourceEtag: etag,
  };
}
