import type { ParsedBookmarkItem } from "./bookmarks";
import {
  folderPath,
  ImportLimitExceeded,
  linkItem,
  notAnExport,
  parseSourceDate,
} from "./sourceItems";

const SOURCE = "Linkwarden";
const MAX_DEPTH = 64;

interface LinkwardenCollection {
  id?: unknown;
  links?: unknown;
  name?: unknown;
  parentId?: unknown;
}

interface LinkwardenLink {
  createdAt?: unknown;
  description?: unknown;
  id?: unknown;
  name?: unknown;
  pinnedBy?: unknown;
  tags?: unknown;
  url?: unknown;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const ids = (value: unknown): Set<unknown> =>
  new Set(
    Array.isArray(value)
      ? value.map((entry: { id?: unknown } | null) => entry?.id)
      : []
  );

/**
 * Linkwarden's JSON backup: `{ collections: [{ id, name, parentId, links:
 * [{ name, url, description, tags: [{ name }], createdAt }] }] }`. The backup
 * is the exporting user's record, so a link they pinned is in their
 * `pinnedLinks`, or has them in its `pinnedBy`.
 */
export function parseLinkwardenJson(json: string): ParsedBookmarkItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    notAnExport(SOURCE);
  }
  const collections = (parsed as { collections?: unknown } | null)?.collections;
  if (!Array.isArray(collections)) {
    notAnExport(SOURCE);
  }
  const user = parsed as { id?: unknown; pinnedLinks?: unknown };
  const pinnedLinks = ids(user.pinnedLinks);
  const isPinned = (link: LinkwardenLink | null) =>
    (link?.id !== undefined && pinnedLinks.has(link.id)) ||
    (user.id !== undefined && ids(link?.pinnedBy).has(user.id));
  const byId = new Map<unknown, LinkwardenCollection>();
  for (const collection of collections as LinkwardenCollection[]) {
    if (collection && typeof collection === "object") {
      byId.set(collection.id, collection);
    }
  }
  const pathOf = (collection: LinkwardenCollection): string | undefined => {
    const names: string[] = [];
    const seen = new Set<unknown>();
    let current: LinkwardenCollection | undefined = collection;
    while (current && !seen.has(current.id) && names.length < MAX_DEPTH) {
      seen.add(current.id);
      names.unshift(text(current.name));
      current =
        current.parentId === null || current.parentId === undefined
          ? undefined
          : byId.get(current.parentId);
    }
    return folderPath(names);
  };

  const output: ParsedBookmarkItem[] = [];
  for (const collection of byId.values()) {
    if (!Array.isArray(collection.links)) {
      continue;
    }
    const folder = pathOf(collection);
    for (const link of collection.links as Array<LinkwardenLink | null>) {
      if (output.length >= 10_000) {
        throw new ImportLimitExceeded("Linkwarden backup exceeds 10,000 links");
      }
      const tags = Array.isArray(link?.tags)
        ? (link.tags as Array<{ name?: unknown } | null>).map((tag) =>
            text(tag?.name)
          )
        : [];
      output.push(
        linkItem(SOURCE, {
          url: text(link?.url),
          title: text(link?.name),
          notes: text(link?.description),
          tags,
          folders: folder ? [folder] : undefined,
          createdAt: parseSourceDate(text(link?.createdAt)),
          isFavorited: isPinned(link),
        })
      );
    }
  }
  return output;
}
