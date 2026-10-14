import { MAX_FOLDERS_PER_CARD } from "../shared/folders";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ParsedBookmarkItem } from "./bookmarks";
import { parseImportedTimestamp } from "./validate";

/** What every import source can say about one saved link. */
export interface SourceLink {
  createdAt?: number;
  folders?: string[];
  isArchived?: boolean;
  isFavorited?: boolean;
  notes?: string;
  tags?: string[];
  title?: string;
  url: string;
}

const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;
const MAX_NOTES_LENGTH = 100_000;

/**
 * Tags as a card accepts them: trimmed, without blanks or tags longer than
 * 64 characters, deduped, at most 50. Sources are loose about tags, so a bad
 * one is dropped instead of failing the whole card.
 */
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

/** A nested folder as one Teak folder name: "Work / Design / Fonts". */
export function folderPath(segments: Iterable<string>): string | undefined {
  const parts: string[] = [];
  for (const segment of segments) {
    const part = segment.replace(/\s+/g, " ").trim();
    if (part) {
      parts.push(part);
    }
  }
  return parts.length ? parts.join(" / ") : undefined;
}

/**
 * A saved date from a source: unix seconds or milliseconds (as a number or
 * digits), or an ISO-like date string ("2024-03-01 10:00:00+00:00" too).
 * Out-of-range or unreadable dates are dropped.
 */
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
    // Ten-digit values are seconds; thirteen-digit ones milliseconds.
    return parseImportedTimestamp(value < 1e11 ? value * 1000 : value);
  }
  const text = raw.trim();
  if (!text) {
    return;
  }
  // "YYYY-MM-DD HH:MM" is common in CSV exports; make it ISO.
  return parseImportedTimestamp(
    text.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2")
  );
}

/**
 * One saved link as an import item: a link card, or an item that fails with
 * a reason when its URL can't be imported.
 */
export function linkItem(source: string, link: SourceLink): ParsedBookmarkItem {
  const rawUrl = link.url.trim();
  const url = sanitizeExternalUrl(rawUrl);
  const title = link.title?.replace(/\s+/g, " ").trim() ?? "";
  if (!url) {
    return {
      label: title || rawUrl || `${source} item`,
      error: rawUrl
        ? `${source} link is unsafe: only http and https links can be imported`
        : `${source} item has no link`,
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
      folders: folders.length ? folders : undefined,
      isFavorited: link.isFavorited === true || undefined,
      isArchived: link.isArchived === true || undefined,
      createdAt: link.createdAt,
    },
  };
}

/** Throws the error every parser raises for a file from the wrong source. */
export function notAnExport(source: string): never {
  const article = /^[aeiou]/i.test(source) ? "an" : "a";
  throw new Error(`This doesn't look like ${article} ${source} export`);
}
