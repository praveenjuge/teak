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

export type TextImportMode = Exclude<ImportMode, "archive">;

export function parseImportSource(
  mode: TextImportMode,
  text: string
): ParsedBookmarkItem[] {
  switch (mode) {
    case "bookmarks":
      return parseBookmarksHtml(text);
    case "pocket":
      return parsePocketExport(text);
    case "raindrop":
      return parseRaindropCsv(text);
    case "instapaper":
      return parseInstapaperCsv(text);
    case "readwise":
      return parseReadwiseCsv(text);
    case "omnivore":
      return parseOmnivoreJson(text);
    case "linkwarden":
      return parseLinkwardenJson(text);
    case "mymind":
      return parseMymindCsv(text);
    case "onetab":
      return parseOneTabText(text);
    default:
      throw new Error(`Unsupported import source: ${mode satisfies never}`);
  }
}
