import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ParsedBookmarkItem } from "./bookmarks";
import { isEmptyRow, parseCsvRows } from "./csv";
import { cleanTags, folderPath } from "./sourceItems";
import { parseImportedTimestamp } from "./validate";

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

/**
 * Parses a Raindrop.io CSV export into the shared bookmark item shape so it
 * reuses the same downstream normalization as the HTML bookmark importer.
 *
 * Columns are matched by header name (case-insensitive), so both the full
 * export (`id, title, note, excerpt, url, folder, tags, created, cover,
 * highlights, favorite`) and the import-compatible subset are supported. The
 * `url` column is required; `id`, `excerpt`, `cover`, and `highlights` are
 * ignored. The `folder` column becomes a Teak folder.
 */
export function parseRaindropCsv(csv: string): ParsedBookmarkItem[] {
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
        error:
          "Raindrop bookmark URL is unsafe: only http and https links can be imported",
      });
      continue;
    }
    const tags = cleanTags(cell(row, "tags").split(","));
    // Raindrop nests collections as "Parent/Child"; one Teak folder each.
    const folder = folderPath(cell(row, "folder").split("/"));
    const notes = cell(row, "note");
    output.push({
      label: title || url,
      card: {
        type: "link",
        content: title || url,
        url,
        tags,
        folders: folder ? [folder] : undefined,
        notes: notes || undefined,
        isFavorited: isTruthyFavorite(cell(row, "favorite")) || undefined,
        createdAt: parseRaindropCreated(cell(row, "created")),
      },
    });
  }
  return output;
}
