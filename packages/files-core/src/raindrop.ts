import type { ParsedBookmarkItem } from "./bookmarks";
import { parseImportedTimestamp } from "./importValidate";
import { sanitizeExternalUrl } from "./safeUrl";

/**
 * Minimal RFC-4180 CSV parser. Handles quoted fields, embedded commas and
 * newlines, `""` escaping, and CRLF/LF/CR line endings. Returns rows of raw
 * (untrimmed) cell strings. Dependency-free, matching the repo's hand-rolled
 * parsing style in `bookmarks.ts`.
 */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let pieces: string[] = [];
  let blocks: string[] = [];
  let pieceLength = 0;
  const appendPiece = (piece: string) => {
    pieces.push(piece);
    pieceLength += piece.length;
    if (pieceLength >= 65_536 || pieces.length >= 1024) {
      blocks.push(pieces.join(""));
      pieces = [];
      pieceLength = 0;
    }
  };
  let fieldStart = 0;
  let inQuotes = false;
  let index = 0;
  const length = input.length;
  const endField = () => {
    if (row.length >= 256) {
      throw new Error("Raindrop CSV has too many columns");
    }
    appendPiece(input.slice(fieldStart, index));
    blocks.push(pieces.join(""));
    row.push(blocks.join(""));
    pieces = [];
    blocks = [];
    pieceLength = 0;
    fieldStart = index + 1;
  };
  const endRow = () => {
    endField();
    if (rows.length === 0 || !isEmptyRow(row)) {
      if (rows.length > 10_000) {
        throw new Error("Raindrop CSV exceeds 10,000 bookmarks");
      }
      rows.push(row);
    }
    row = [];
  };
  while (index < length) {
    const char = input[index];
    if (char === '"') {
      appendPiece(input.slice(fieldStart, index));
      if (inQuotes && input[index + 1] === '"') {
        appendPiece('"');
        index += 2;
      } else {
        inQuotes = !inQuotes;
        index += 1;
      }
      fieldStart = index;
      continue;
    }
    if (!inQuotes && char === ",") {
      endField();
    }
    if (!inQuotes && (char === "\r" || char === "\n")) {
      endRow();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
        fieldStart = index + 1;
      }
    }
    index += 1;
  }
  if (fieldStart < length || pieces.length || blocks.length || row.length) {
    endRow();
  }
  return rows;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/**
 * Parses a Raindrop `created` value. Raindrop exports an ISO 8601 timestamp,
 * but an all-digits value is treated as unix seconds (mirroring the `add_date`
 * handling in `bookmarks.ts`).
 */
function parseRaindropCreated(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds > 0
      ? parseImportedTimestamp(seconds * 1000)
      : undefined;
  }
  return parseImportedTimestamp(trimmed);
}

function isTruthyFavorite(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function collectTags(folder: string, tags: string): string[] {
  const collected: string[] = [];
  // Folder nesting becomes individual tags, matching the bookmark importer.
  for (const segment of folder.split("/")) {
    const tag = segment.trim();
    if (tag) {
      collected.push(tag);
    }
  }
  for (const segment of tags.split(",")) {
    const tag = segment.trim();
    if (tag) {
      collected.push(tag);
    }
  }
  return [...new Set(collected)];
}

/**
 * Parses a Raindrop.io CSV export into the shared bookmark item shape so it
 * reuses the same downstream normalization as the HTML bookmark importer.
 *
 * Columns are matched by header name (case-insensitive), so both the full
 * export (`id, title, note, excerpt, url, folder, tags, created, cover,
 * highlights, favorite`) and the import-compatible subset are supported. The
 * `url` column is required; `id`, `excerpt`, `cover`, and `highlights` are
 * ignored.
 */
export function parseRaindropCsv(csv: string): ParsedBookmarkItem[] {
  // Strip a leading UTF-8 BOM if present.
  const normalized = csv.charCodeAt(0) === 0xfe_ff ? csv.slice(1) : csv;
  const rows = parseCsvRows(normalized);
  if (rows.length === 0) {
    throw new Error("Raindrop CSV is empty");
  }

  const header = rows[0];
  const columns = new Map<string, number>();
  header.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    if (key && !columns.has(key)) {
      columns.set(key, index);
    }
  });
  if (!columns.has("url")) {
    throw new Error("Raindrop CSV is missing a url column");
  }

  const cell = (row: string[], column: string): string => {
    const index = columns.get(column);
    if (index === undefined) {
      return "";
    }
    return (row[index] ?? "").trim();
  };

  const output: ParsedBookmarkItem[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (isEmptyRow(row)) {
      continue;
    }
    const rawUrl = cell(row, "url");
    const url = sanitizeExternalUrl(rawUrl);
    const title = cell(row, "title");
    if (!url) {
      output.push({
        label: title || rawUrl || "Raindrop bookmark",
        error: "Raindrop bookmark URL is unsafe",
      });
      continue;
    }
    const tags = collectTags(cell(row, "folder"), cell(row, "tags"));
    const notes = cell(row, "note");
    output.push({
      label: title || url,
      card: {
        type: "link",
        content: title || url,
        url,
        tags: tags.length ? tags : undefined,
        notes: notes || undefined,
        isFavorited: isTruthyFavorite(cell(row, "favorite")) || undefined,
        createdAt: parseRaindropCreated(cell(row, "created")),
      },
    });
  }
  return output;
}
