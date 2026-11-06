import type { ParsedBookmarkItem } from "./bookmarks";
import { parseOmnivoreHighlights } from "./highlightText";
import { linkItem, notAnExport, parseSourceDate } from "./sourceItems";

const SOURCE = "Omnivore";

/**
 * Omnivore's export ZIP holds `metadata_<start>_to_<end>.json` files (end
 * exclusive), each a JSON list of saved items, and `highlights/<slug>.md`
 * for items with highlights.
 */
export const OMNIVORE_METADATA_PATTERN =
  /(?:^|\/)metadata_(\d+)_to_(\d+)\.json$/;

export const omnivoreHighlightsPath = (slug: string) => `highlights/${slug}.md`;

export interface OmnivoreItem {
  labels?: unknown;
  savedAt?: unknown;
  slug?: unknown;
  state?: unknown;
  title?: unknown;
  url?: unknown;
}

export function readOmnivoreMetadata(json: string): OmnivoreItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    notAnExport(SOURCE);
  }
  if (
    !(
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          item && typeof item === "object" && "url" in item && "savedAt" in item
      )
    )
  ) {
    notAnExport(SOURCE);
  }
  return parsed as OmnivoreItem[];
}

/**
 * One Omnivore item as an import item: labels become tags, "Archived"
 * archive state, savedAt the saved date, and its highlights file (Markdown,
 * when given) highlights with their notes. A file with no `> quote` in it
 * stays the card's note, so nothing in it is lost.
 */
export function omnivoreItem(
  item: OmnivoreItem,
  highlightsMarkdown?: string
): ParsedBookmarkItem {
  const highlights = highlightsMarkdown
    ? parseOmnivoreHighlights(highlightsMarkdown)
    : [];
  const labels = Array.isArray(item.labels)
    ? item.labels.filter((label): label is string => typeof label === "string")
    : [];
  return linkItem(SOURCE, {
    url: typeof item.url === "string" ? item.url : "",
    title: typeof item.title === "string" ? item.title : "",
    tags: labels,
    highlights,
    notes: highlights.length > 0 ? undefined : highlightsMarkdown,
    createdAt: parseSourceDate(
      typeof item.savedAt === "string" || typeof item.savedAt === "number"
        ? item.savedAt
        : undefined
    ),
    isArchived: item.state === "Archived",
  });
}

export function parseOmnivoreJson(json: string): ParsedBookmarkItem[] {
  return readOmnivoreMetadata(json).map((item) => omnivoreItem(item));
}
