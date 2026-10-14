import type { ParsedBookmarkItem } from "./bookmarks";
import { linkItem, notAnExport, parseSourceDate } from "./sourceItems";

const SOURCE = "Omnivore";

/**
 * Omnivore's export ZIP holds `metadata_<start>_to_<end>.json` files (end
 * exclusive), each a JSON list of saved items, and `highlights/<slug>.md`
 * for items with highlights.
 */
export const OMNIVORE_METADATA_PATTERN =
  /(?:^|\/)metadata_(\d+)_to_(\d+)\.json$/;

/** Where an item's highlights live in the export ZIP. */
export const omnivoreHighlightsPath = (slug: string) => `highlights/${slug}.md`;

export interface OmnivoreItem {
  labels?: unknown;
  savedAt?: unknown;
  slug?: unknown;
  state?: unknown;
  title?: unknown;
  url?: unknown;
}

/** Reads one metadata file's JSON list, or throws for anything else. */
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
 * archive state, savedAt the saved date, and its highlights (Markdown, when
 * given) the card's note.
 */
export function omnivoreItem(
  item: OmnivoreItem,
  highlights?: string
): ParsedBookmarkItem {
  const labels = Array.isArray(item.labels)
    ? item.labels.filter((label): label is string => typeof label === "string")
    : [];
  return linkItem(SOURCE, {
    url: typeof item.url === "string" ? item.url : "",
    title: typeof item.title === "string" ? item.title : "",
    tags: labels,
    notes: highlights,
    createdAt: parseSourceDate(
      typeof item.savedAt === "string" || typeof item.savedAt === "number"
        ? item.savedAt
        : undefined
    ),
    isArchived: item.state === "Archived",
  });
}

/** A single metadata JSON file uploaded on its own. */
export function parseOmnivoreJson(json: string): ParsedBookmarkItem[] {
  return readOmnivoreMetadata(json).map((item) => omnivoreItem(item));
}
