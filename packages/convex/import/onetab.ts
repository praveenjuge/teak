import type { ParsedBookmarkItem } from "./bookmarks";
import { ImportLimitExceeded, linkItem, notAnExport } from "./sourceItems";

const SOURCE = "OneTab";

/**
 * OneTab's "Export URLs" text: one `URL | Title` line per tab, tab groups
 * separated by blank lines.
 */
export function parseOneTabText(text: string): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const separator = line.indexOf(" | ");
    const url = (separator === -1 ? line : line.slice(0, separator)).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      continue;
    }
    if (output.length >= 10_000) {
      throw new ImportLimitExceeded("OneTab export exceeds 10,000 links");
    }
    output.push(
      linkItem(SOURCE, {
        url,
        title: separator === -1 ? "" : line.slice(separator + 3),
      })
    );
  }
  if (output.length === 0) {
    notAnExport(SOURCE);
  }
  return output;
}
