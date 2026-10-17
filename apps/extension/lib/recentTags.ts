import { siteStorageKey } from "./captureOwner";

/** The most tags the extension remembers. */
export const MAX_RECENT_TAGS = 20;
/** The most suggestions shown under the tag input. */
export const MAX_TAG_SUGGESTIONS = 8;

export const recentTagsKey = () => siteStorageKey("teakRecentTags");

interface StoredRecentTags {
  tags: string[];
  userId: string;
}

const tagKey = (tag: string) => tag.trim().toLowerCase();

/**
 * The tags just used first, then the ones remembered before, without
 * repeats (ignoring case) and at most 20.
 */
export const mergeRecentTags = (
  used: readonly string[],
  remembered: readonly string[]
): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...used, ...remembered]) {
    const name = tag.trim();
    if (name && !seen.has(tagKey(name))) {
      seen.add(tagKey(name));
      merged.push(name);
    }
  }
  return merged.slice(0, MAX_RECENT_TAGS);
};

/** The tags this user last used in the extension; none for anyone else. */
export async function readRecentTags(userId: string): Promise<string[]> {
  const stored = (await chrome.storage.local.get(recentTagsKey()))[
    recentTagsKey()
  ] as StoredRecentTags | undefined;
  return stored?.userId === userId && Array.isArray(stored.tags)
    ? stored.tags.filter((tag) => typeof tag === "string")
    : [];
}

export async function rememberTags(
  userId: string,
  used: readonly string[]
): Promise<void> {
  if (used.length === 0) {
    return;
  }
  // Callers pass the tags a change added, in the order they were added.
  const tags = mergeRecentTags(
    [...used].reverse(),
    await readRecentTags(userId)
  );
  await chrome.storage.local.set({
    [recentTagsKey()]: { tags, userId } satisfies StoredRecentTags,
  });
}

/** Signing out forgets them. */
export const clearRecentTags = () =>
  chrome.storage.local.remove(recentTagsKey());

/**
 * Up to 8 tags to offer: the recent ones, then the library's most used,
 * leaving out tags the card already has, and narrowed to those containing
 * what's typed.
 */
export const suggestTags = ({
  library,
  query,
  recent,
  selected,
}: {
  library: readonly string[];
  query: string;
  recent: readonly string[];
  selected: readonly string[];
}): string[] => {
  const taken = new Set(selected.map(tagKey));
  const typed = tagKey(query);
  const suggestions: string[] = [];
  for (const tag of [...recent, ...library]) {
    const key = tagKey(tag);
    if (!key || taken.has(key) || (typed && !key.includes(typed))) {
      continue;
    }
    taken.add(key);
    suggestions.push(tag.trim());
    if (suggestions.length === MAX_TAG_SUGGESTIONS) {
      break;
    }
  }
  return suggestions;
};
