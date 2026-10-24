import type { ParsedBookmarkItem } from "./bookmarks";
import { readCsvTable } from "./csv";
import {
  folderPath,
  linkItem,
  notAnExport,
  parseSourceDate,
} from "./sourceItems";

const SOURCE = "Instapaper";

const parseJsonOrUndefined = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

function parseTags(raw: string): string[] {
  if (!raw) {
    return [];
  }
  const parsed = parseJsonOrUndefined(raw);
  return Array.isArray(parsed)
    ? parsed.map((tag) => String(tag))
    : raw.split(",");
}

/**
 * Instapaper's CSV export: `URL, Title, Selection, Folder, Timestamp` and,
 * in newer exports, `Tags`. Folder is "Unread", "Archive", "Starred" or a
 * folder of the user's. Selection is the highlighted passage, which becomes
 * the link's highlight.
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
      // The highlighted passage: a highlight, found once Teak has the
      // article.
      highlights: [{ quote: table.cell(row, "selection") }],
      tags: parseTags(table.cell(row, "tags")),
      folders: name ? [name] : undefined,
      isArchived: kind === "archive",
      isFavorited: kind === "starred",
      createdAt: parseSourceDate(table.cell(row, "timestamp")),
    });
  });
}
