import { JSONParser, TokenType } from "@streamparser/json";
import {
  FILES_IMPORT_PAGE_BYTES,
  FILES_IMPORT_PAGE_ITEMS,
  type FilesImportIndexItem,
} from "@teak/files-protocol";
import {
  consumeZipEntry,
  type ZipCentralEntry,
  type ZipDirectory,
} from "./zip";

/** Discard completed siblings; retain only this page, never the 64 MiB JSON document. */
export async function readImportJson(
  bucket: R2Bucket,
  key: string,
  directory: ZipDirectory,
  entry: ZipCentralEntry,
  cursor: number
) {
  const items: FilesImportIndexItem[] = [];
  let total = 0,
    pageBytes = 0,
    full = false,
    hasCards = false;
  let cardsArrays = 0;
  let version: unknown, exportVersion: unknown;
  let parser: JSONParser | undefined;
  let rootArray = false,
    depth = 0,
    lastRootKey = "",
    valueBytes = 0;
  const entries = new Map(
    directory.entries.map((value) => [value.name, value])
  );
  const initialize = (chunk: Uint8Array) => {
    const first = new TextDecoder().decode(chunk).trimStart()[0];
    if (!first) {
      return;
    }
    rootArray = first === "[";
    hasCards = rootArray;
    parser = new JSONParser({
      paths: rootArray
        ? ["$.*"]
        : ["$.cards.*", "$.version", "$.exportVersion"],
      keepStack: false,
      stringBufferSize: 65_536,
      emitPartialTokens: true,
    });
    parser.onError = (error) => {
      if (error.message.startsWith("invalid_archive")) {
        throw error;
      }
      throw new Error("archive_parse_failed", { cause: error });
    };
    parser.onToken = ({ token, value, partial }) => {
      if (typeof value === "string" && value.length > 1024 * 1024) {
        throw new Error("invalid_archive_json_value_size");
      }
      if (partial) {
        return;
      }
      if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
        if (
          depth === 1 &&
          lastRootKey === "cards" &&
          token === TokenType.LEFT_BRACKET
        ) {
          cardsArrays += 1;
          if (cardsArrays > 1) {
            throw new Error("invalid_archive_duplicate_cards");
          }
          hasCards = true;
        }
        depth++;
        if (depth > 64) {
          throw new Error("invalid_archive_json_depth");
        }
      } else if (
        token === TokenType.RIGHT_BRACE ||
        token === TokenType.RIGHT_BRACKET
      ) {
        depth--;
      } else if (depth === 1 && token === TokenType.STRING) {
        lastRootKey = String(value);
      }
      valueBytes += typeof value === "string" ? value.length : 8;
      if (valueBytes > FILES_IMPORT_PAGE_BYTES) {
        throw new Error("invalid_archive_json_value_size");
      }
    };
    parser.onValue = ({ key: field, value, stack }) => {
      if (!rootArray && stack.length === 1) {
        if (field === "version") {
          version = value;
        }
        if (field === "exportVersion") {
          exportVersion = value;
        }
        valueBytes = 0;
        return;
      }
      const sourceIndex = total++;
      valueBytes = 0;
      if (total > 10_000) {
        throw new Error("invalid_archive_card_count");
      }
      if (sourceIndex < cursor || full) {
        return;
      }
      const item: FilesImportIndexItem = { sourceIndex, card: value };
      const raw = value as { file?: { path?: unknown } } | null;
      if (typeof raw?.file?.path === "string") {
        const file = entries.get(raw.file.path);
        if (file && !file.name.endsWith("/")) {
          item.file = {
            path: file.name,
            uncompressedSize: file.uncompressedSize,
          };
        }
      }
      const size = new TextEncoder().encode(JSON.stringify(item)).length;
      if (size > FILES_IMPORT_PAGE_BYTES) {
        item.card = undefined;
        item.error = "Import item is too large";
        item.label = `Item ${sourceIndex + 1}`;
      }
      const boundedSize = new TextEncoder().encode(JSON.stringify(item)).length;
      if (
        items.length &&
        (pageBytes + boundedSize > FILES_IMPORT_PAGE_BYTES ||
          items.length >= FILES_IMPORT_PAGE_ITEMS)
      ) {
        full = true;
        return;
      }
      items.push(item);
      pageBytes += boundedSize;
    };
  };
  await consumeZipEntry(
    bucket,
    key,
    directory,
    entry,
    64 * 1024 * 1024,
    (chunk) => {
      if (!parser) {
        initialize(chunk);
      }
      parser?.write(chunk);
    },
    Number.POSITIVE_INFINITY
  );
  if (!parser) {
    throw new Error("archive_parse_failed");
  }
  if (!parser.isEnded) {
    parser.end();
  }
  return { items, total, hasCards, version: version ?? exportVersion };
}
