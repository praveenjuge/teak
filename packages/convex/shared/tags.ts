/** Longest tag, in UTF-16 units after trimming, like card tag edits. */
export const MAX_TAG_NAME_LENGTH = 64;

/** Most cards counted for an operation's total when it starts. */
export const TAG_OPERATION_COUNT_LIMIT = 10_000;

/**
 * A running operation that hasn't made progress for this long has stopped
 * (a lost batch): the app offers Retry, and starting another replaces it.
 */
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

/** The tag as matched everywhere: trimmed and lowercased. */
export const tagKey = (tag: string): string => tag.trim().toLowerCase();

/** Why a tag name is refused, or null when it is fine. */
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

/**
 * The longest tag being changed: a tag's lowercase key can be longer than
 * the name (64 of "İ" lowercase to 128 code units), and the app passes keys.
 */
export const MAX_TAG_KEY_LENGTH = 256;

/** Why the tag being changed is refused, or null when it is fine. */
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

export interface TagRewrite {
  /** The tag being changed, matched ignoring case. */
  from: string;
  kind: TagOperationKind;
  /** The new name (rename) or the tag merged into (merge). */
  to?: string;
}

/**
 * A card's tag list after a library-wide change, or null when the change
 * leaves it as it is. Tags match ignoring case and the result has no two
 * tags that differ only by case. Rename writes the new name exactly as
 * given; merge keeps the casing a card already uses for the target. Every
 * other tag keeps its place and casing.
 */
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
  if (rewrite.kind === "delete" || rewrite.to === undefined) {
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
