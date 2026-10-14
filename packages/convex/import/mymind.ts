import type { ParsedBookmarkItem } from "./bookmarks";
import { readCsvTable } from "./csv";
import {
  cleanTags,
  linkItem,
  notAnExport,
  parseSourceDate,
} from "./sourceItems";

const SOURCE = "mymind";
const MAX_NOTES_LENGTH = 100_000;

/**
 * mymind's CSV export: `id, type, title, url, content, note, tags, created`.
 * A card with a URL becomes a link card; one with only text becomes a note
 * card, its title as a heading. Tags are comma-separated.
 */
export function parseMymindCsv(csv: string): ParsedBookmarkItem[] {
  const table = readCsvTable(csv);
  if (!(table.has("url") && table.has("content") && table.has("tags"))) {
    notAnExport(SOURCE);
  }
  return table.rows.map((row): ParsedBookmarkItem => {
    const url = table.cell(row, "url");
    const title = table.cell(row, "title");
    const text = table.cell(row, "content");
    const tags = table.cell(row, "tags").split(",");
    const notes = table.cell(row, "note");
    const createdAt = parseSourceDate(table.cell(row, "created"));
    if (url) {
      return linkItem(SOURCE, { url, title, tags, notes, createdAt });
    }
    if (!text) {
      return {
        label: title || `${SOURCE} item`,
        error: `${SOURCE} item has no link or text`,
      };
    }
    return {
      label: title || text.slice(0, 80),
      card: {
        type: "text",
        content: title ? `# ${title}\n\n${text}` : text,
        tags: cleanTags(tags),
        notes: notes.slice(0, MAX_NOTES_LENGTH) || undefined,
        createdAt,
      },
    };
  });
}
