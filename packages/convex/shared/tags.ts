export const MAX_TAG_NAME_LENGTH = 64;

export const TAG_OPERATION_COUNT_LIMIT = 10_000;

export const TAG_OPERATION_STALL_MS = 2 * 60_000;

export type TagOperationKind = "rename" | "merge" | "delete";
export type TagOperationStatus = "running" | "completed" | "failed";

export const TAG_ERROR_MESSAGES = {
  EMPTY_NAME: "Name the tag",
  NAME_TOO_LONG: `Tags can be at most ${MAX_TAG_NAME_LENGTH} characters`,
  NOT_FOUND: "Tag not found",
  SAME_TAG: "Choose a different tag to merge into",
  OPERATION_RUNNING: "Another tag change is still running",
  OPERATION_NOT_FOUND: "Tag operation not found",
} as const;

export const tagKey = (tag: string): string => tag.trim().toLowerCase();

export const HIDDEN_TAG_KEYS = ["secret", "hidden"] as const;

const hiddenTagKeys: ReadonlySet<string> = new Set(HIDDEN_TAG_KEYS);

export const isHiddenTagList = (
  tags: readonly string[] | null | undefined
): boolean => (tags ?? []).some((tag) => hiddenTagKeys.has(tagKey(tag)));

// The tag check covers cards the `isHidden` backfill hasn't reached.
export const isCardHidden = (card: {
  isHidden?: true;
  tags?: readonly string[];
}): boolean => card.isHidden === true || isHiddenTagList(card.tags);

export const explainInvalidTagName = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return TAG_ERROR_MESSAGES.EMPTY_NAME;
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    return TAG_ERROR_MESSAGES.NAME_TOO_LONG;
  }
  return null;
};

// The extension caps a card's tags at the same number; imports keep 50.
export const MAX_CARD_TAGS = 100;

export const CARD_TAG_ERROR_MESSAGES = {
  TAG_TOO_LONG: `Each tag must be at most ${MAX_TAG_NAME_LENGTH} characters`,
  TOO_MANY_TAGS: `A card can have at most ${MAX_CARD_TAGS} tags`,
} as const;

export const normalizeTagList = (tags: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      normalized.push(tag);
    }
  }
  return normalized;
};

/**
 * Why a card can't hold these normalized tags, or null. Tags the card already
 * has (saved before the limits existed) may stay, and a card already past the
 * count may keep or drop tags, never add.
 */
export const explainInvalidCardTags = (
  tags: readonly string[],
  previousTags: readonly string[] = []
): string | null => {
  const kept = new Set(previousTags);
  if (tags.some((tag) => tag.length > MAX_TAG_NAME_LENGTH && !kept.has(tag))) {
    return CARD_TAG_ERROR_MESSAGES.TAG_TOO_LONG;
  }
  if (tags.length > MAX_CARD_TAGS && tags.length > previousTags.length) {
    return CARD_TAG_ERROR_MESSAGES.TOO_MANY_TAGS;
  }
  return null;
};

// Lowercasing can lengthen a tag (64 "İ" become 128 UTF-16 code units), and
// the app passes lowercase keys.
export const MAX_TAG_KEY_LENGTH = 256;

export const explainInvalidTagSource = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) {
    return TAG_ERROR_MESSAGES.EMPTY_NAME;
  }
  return trimmed.length > MAX_TAG_KEY_LENGTH
    ? TAG_ERROR_MESSAGES.NAME_TOO_LONG
    : null;
};

export const tagExistsMessage = (name: string): string =>
  `A tag named "${name.trim()}" already exists. Merge into it instead.`;

export type TagRewrite =
  | { kind: "delete"; from: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "merge"; from: string; to: string };

export const rewriteTagList = (
  tags: readonly string[] | undefined,
  rewrite: TagRewrite
): string[] | null => {
  if (!tags || tags.length === 0) {
    return null;
  }
  const fromKey = tagKey(rewrite.from);
  if (!tags.some((tag) => tagKey(tag) === fromKey)) {
    return null;
  }
  let result: string[];
  if (rewrite.kind === "delete") {
    result = tags.filter((tag) => tagKey(tag) !== fromKey);
  } else {
    const to = rewrite.to.trim();
    const toKey = tagKey(to);
    const target =
      rewrite.kind === "merge"
        ? (tags.find((tag) => tagKey(tag) === toKey) ?? to)
        : to;
    const seen = new Set<string>();
    result = [];
    for (const tag of tags) {
      const key = tagKey(tag);
      const value = key === fromKey || key === toKey ? target : tag;
      const valueKey = tagKey(value);
      if (!seen.has(valueKey)) {
        seen.add(valueKey);
        result.push(value);
      }
    }
  }
  const unchanged =
    result.length === tags.length &&
    result.every((tag, index) => tag === tags[index]);
  return unchanged ? null : result;
};
