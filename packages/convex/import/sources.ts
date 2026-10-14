import type { ImportMode } from "../shared/importSources";
import { type ParsedBookmarkItem, parseBookmarksHtml } from "./bookmarks";
import { parseInstapaperCsv } from "./instapaper";
import { parseLinkwardenJson } from "./linkwarden";
import { parseMymindCsv } from "./mymind";
import { parseOmnivoreJson } from "./omnivore";
import { parseOneTabText } from "./onetab";
import { parsePocketExport } from "./pocket";
import { parseRaindropCsv } from "./raindrop";
import { parseReadwiseCsv } from "./readwise";

/** Sources read from one text file (not a Teak archive or Omnivore ZIP). */
export type TextImportMode = Exclude<ImportMode, "archive">;

const PARSERS: Record<TextImportMode, (text: string) => ParsedBookmarkItem[]> =
  {
    bookmarks: parseBookmarksHtml,
    pocket: parsePocketExport,
    raindrop: parseRaindropCsv,
    instapaper: parseInstapaperCsv,
    readwise: parseReadwiseCsv,
    omnivore: parseOmnivoreJson,
    linkwarden: parseLinkwardenJson,
    mymind: parseMymindCsv,
    onetab: parseOneTabText,
  };

/**
 * Parses a text export from `mode`'s source. Throws when the file isn't one
 * (the Files Worker reports that as an invalid source); items that can't be
 * imported come back with an `error` instead.
 */
export function parseImportSource(
  mode: TextImportMode,
  text: string
): ParsedBookmarkItem[] {
  return PARSERS[mode](text);
}
