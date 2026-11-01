import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
} from "../shared/folders";
import {
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "../shared/highlights/constants";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ParsedBookmarkItem } from "./bookmarks";
import { type ImportHighlightInput, parseImportedTimestamp } from "./validate";

export interface SourceLink {
  createdAt?: number;
  folders?: string[];
  highlights?: ImportHighlightInput[];
  isArchived?: boolean;
  isFavorited?: boolean;
  notes?: string;
  tags?: string[];
  title?: string;
  url: string;
}

const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;
export const MAX_NOTES_LENGTH = 100_000;

export function cleanTags(tags: Iterable<string>): string[] | undefined {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag && tag.length <= MAX_TAG_LENGTH) {
      seen.add(tag);
    }
    if (seen.size === MAX_TAGS) {
      break;
    }
  }
  return seen.size ? [...seen] : undefined;
}

const characters = (text: string) => Array.from(text).length;

export function folderPath(segments: Iterable<string>): string | undefined {
  const parts: string[] = [];
  for (const segment of segments) {
    const part = segment.replace(/\s+/g, " ").trim();
    if (part) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return;
  }
  let name = parts.join(" / ");
  while (characters(name) > MAX_FOLDER_NAME_LENGTH && parts.length > 1) {
    parts.shift();
    name = `… / ${parts.join(" / ")}`;
  }
  return Array.from(name).slice(0, MAX_FOLDER_NAME_LENGTH).join("").trim();
}

export function parseSourceDate(
  raw: string | number | undefined | null
): number | undefined {
  if (raw === undefined || raw === null) {
    return;
  }
  if (typeof raw === "number" || /^\d+(\.\d+)?$/.test(raw.trim())) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    return parseImportedTimestamp(value < 1e11 ? value * 1000 : value);
  }
  const text = raw.trim();
  if (!text) {
    return;
  }
  return parseImportedTimestamp(
    text.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2")
  );
}

/**
 * A source's highlights within Teak's limits: the first 200 with text, a
 * quote past 5,000 characters left out, and a note cut at 2,000.
 */
export function cleanHighlights(
  highlights: Iterable<ImportHighlightInput>
): ImportHighlightInput[] | undefined {
  const kept: ImportHighlightInput[] = [];
  for (const highlight of highlights) {
    const quote = highlight.quote.trim();
    if (!quote || highlightLength(quote) > MAX_HIGHLIGHT_QUOTE_CHARS) {
      continue;
    }
    const note = Array.from(highlight.note?.trim() ?? "")
      .slice(0, MAX_HIGHLIGHT_NOTE_CHARS)
      .join("")
      .trim();
    kept.push(note ? { quote, note } : { quote });
    if (kept.length === MAX_HIGHLIGHTS_PER_CARD) {
      break;
    }
  }
  return kept.length ? kept : undefined;
}

const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Whether a parsed link's host can be a web address: an IP, `localhost`, or
 * dotted DNS labels. `new URL` accepts hosts like `a..b` or a single word.
 */
export function isImportableHost(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.startsWith("[") ||
    IPV4.test(hostname)
  ) {
    return true;
  }
  const labels = hostname.replace(/\.$/, "").split(".");
  return labels.length >= 2 && labels.every((label) => HOST_LABEL.test(label));
}

/**
 * Why a source's link can't become a card, or `undefined` when it can.
 * `new URL` quietly drops line breaks and encodes spaces, so a cell that ran
 * into the next row, or a sentence, would otherwise pass as a link.
 */
export function importLinkProblem(
  source: string,
  rawUrl: string
): string | undefined {
  if (!rawUrl) {
    return `${source} item has no link`;
  }
  const unsafe = `${source} link is unsafe: only http and https links can be imported`;
  const invalid = `${source} link isn't a valid web address`;
  if (/\s/.test(rawUrl)) {
    return /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) && !/^https?:/i.test(rawUrl)
      ? unsafe
      : invalid;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return invalid;
  }
  if (!sanitizeExternalUrl(rawUrl)) {
    return unsafe;
  }
  return isImportableHost(parsed.hostname) ? undefined : invalid;
}

export function linkItem(source: string, link: SourceLink): ParsedBookmarkItem {
  const rawUrl = link.url.trim();
  const title = link.title?.replace(/\s+/g, " ").trim() ?? "";
  const problem = importLinkProblem(source, rawUrl);
  const url = problem ? undefined : sanitizeExternalUrl(rawUrl);
  if (problem || !url) {
    return {
      label: title || rawUrl || `${source} item`,
      error: problem ?? `${source} item has no link`,
    };
  }
  const notes = link.notes?.trim().slice(0, MAX_NOTES_LENGTH);
  const folders = [
    ...new Set((link.folders ?? []).filter((name) => name.trim())),
  ].slice(0, MAX_FOLDERS_PER_CARD);
  return {
    label: title || url,
    card: {
      type: "link",
      content: title || url,
      url,
      tags: cleanTags(link.tags ?? []),
      notes: notes || undefined,
      highlights: cleanHighlights(link.highlights ?? []),
      folders: folders.length ? folders : undefined,
      isFavorited: link.isFavorited === true || undefined,
      isArchived: link.isArchived === true || undefined,
      createdAt: link.createdAt,
    },
  };
}

export class ImportLimitExceeded extends Error {
  override name = "ImportLimitExceeded";
}

export function notAnExport(source: string): never {
  const article = /^[aeiou]/i.test(source) ? "an" : "a";
  throw new Error(`This doesn't look like ${article} ${source} export`);
}
