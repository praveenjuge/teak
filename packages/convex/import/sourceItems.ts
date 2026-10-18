import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
} from "../shared/folders";
import { sanitizeExternalUrl } from "../shared/utils/safeUrl";
import type { ParsedBookmarkItem } from "./bookmarks";
import { parseImportedTimestamp } from "./validate";

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

export class ImportLimitExceeded extends Error {
  override name = "ImportLimitExceeded";
}

export function notAnExport(source: string): never {
  const article = /^[aeiou]/i.test(source) ? "an" : "a";
  throw new Error(`This doesn't look like ${article} ${source} export`);
}
