import type { ParsedBookmarkItem } from "./bookmarks";
import { readCsvTable } from "./csv";
import {
  folderPath,
  linkItem,
  notAnExport,
  parseSourceDate,
} from "./sourceItems";

const SOURCE = "Instapaper";

/** Instapaper writes Tags as a JSON list, e.g. `["design","fonts"]`. */
function parseTags(raw: string): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag));
    }
  } catch {
    // Not JSON: fall back to a comma-separated list.
  }
  return raw.split(",");
}

/**
 * Instapaper's CSV export: `URL, Title, Selection, Folder, Timestamp` and,
 * in newer exports, `Tags`. Folder is "Unread", "Archive", "Starred" or a
 * folder of the user's: Archive and Starred become archive state and
 * favorites, other folders become Teak folders. Selection (the highlighted
 * passage) becomes the card's note.
 */
export function parseInstapaperCsv(csv: string): ParsedBookmarkItem[] {
  const table = readCsvTable(csv);
  if (!(table.has("url") && table.has("folder"))) {
    notAnExport(SOURCE);
  }
  return table.rows.map((row) => {
    const folder = table.cell(row, "folder");
    const kind = folder.toLowerCase();
    const isSystem =
      kind === "unread" || kind === "archive" || kind === "starred";
    const name = isSystem ? undefined : folderPath([folder]);
    return linkItem(SOURCE, {
      url: table.cell(row, "url"),
      title: table.cell(row, "title"),
      notes: table.cell(row, "selection"),
      tags: parseTags(table.cell(row, "tags")),
      folders: name ? [name] : undefined,
      isArchived: kind === "archive",
      isFavorited: kind === "starred",
      createdAt: parseSourceDate(table.cell(row, "timestamp")),
    });
  });
}
