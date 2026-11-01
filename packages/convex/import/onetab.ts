import type { ParsedBookmarkItem } from "./bookmarks";
import { ImportLimitExceeded, linkItem, notAnExport } from "./sourceItems";

const MAX_LINE_LABEL = 200;

/**
 * OneTab's "Export URLs" text: one `URL | Title` line per tab, tab groups
 * separated by blank lines. The "Text file of links" source reads the same
 * shape; `source` names it in errors. A line that isn't a link goes to the
 * report with its line number; a file with no links at all is not an export.
 */
export function parseOneTabText(
  text: string,
  source = "OneTab"
): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  let links = 0;
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (output.length >= 10_000) {
      throw new ImportLimitExceeded(`${source} exceeds 10,000 links`);
    }
    const separator = line.indexOf(" | ");
    const url = (separator === -1 ? line : line.slice(0, separator)).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      output.push({
        label: Array.from(line).slice(0, MAX_LINE_LABEL).join(""),
        error: `Line ${index + 1} isn't a link`,
      });
      continue;
    }
    links += 1;
    output.push(
      linkItem(source, {
        url,
        title: separator === -1 ? "" : line.slice(separator + 3),
      })
    );
  }
  if (links === 0) {
    notAnExport(source);
  }
  return output;
}
