import type { ParsedBookmarkItem } from "./bookmarks";
import { ImportLimitExceeded, linkItem, notAnExport } from "./sourceItems";

/**
 * OneTab's "Export URLs" text: one `URL | Title` line per tab, tab groups
 * separated by blank lines. The "Text file of links" source reads the same
 * shape; `source` names it in errors.
 */
export function parseOneTabText(
  text: string,
  source = "OneTab"
): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const separator = line.indexOf(" | ");
    const url = (separator === -1 ? line : line.slice(0, separator)).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      continue;
    }
    if (output.length >= 10_000) {
      throw new ImportLimitExceeded(`${source} exceeds 10,000 links`);
    }
    output.push(
      linkItem(source, {
        url,
        title: separator === -1 ? "" : line.slice(separator + 3),
      })
    );
  }
  if (output.length === 0) {
    notAnExport(source);
  }
  return output;
}
