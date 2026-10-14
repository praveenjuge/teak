import type { ParsedBookmarkItem } from "./bookmarks";
import { readCsvTable } from "./csv";
import { linkItem, notAnExport, parseSourceDate } from "./sourceItems";

const SOURCE = "Readwise Reader";

/**
 * Reader writes Document tags as a Python-style list, `['design', "it's"]`.
 * Reads every quoted string, either quote style, with backslash escapes.
 */
export function parseReaderTags(raw: string): string[] {
  const tags: string[] = [];
  for (const match of raw.matchAll(
    /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g
  )) {
    tags.push((match[1] ?? match[2] ?? "").replace(/\\(.)/g, "$1"));
  }
  return tags;
}

/**
 * Readwise Reader's library CSV: `Title, URL, ID, Document tags, Saved date,
 * Reading progress, Location, Seen`. Feed items (RSS Reader added on its
 * own) are skipped; Location "archive" becomes archive state and
 * "shortlist" a favorite.
 */
export function parseReadwiseCsv(csv: string): ParsedBookmarkItem[] {
  const table = readCsvTable(csv);
  if (!(table.has("url") && table.has("location"))) {
    notAnExport(SOURCE);
  }
  const output: ParsedBookmarkItem[] = [];
  for (const row of table.rows) {
    const location = table.cell(row, "location").toLowerCase();
    if (location === "feed") {
      continue;
    }
    output.push(
      linkItem(SOURCE, {
        url: table.cell(row, "url"),
        title: table.cell(row, "title"),
        tags: parseReaderTags(table.cell(row, "document tags")),
        createdAt: parseSourceDate(table.cell(row, "saved date")),
        isArchived: location === "archive",
        isFavorited: location === "shortlist",
      })
    );
  }
  return output;
}
