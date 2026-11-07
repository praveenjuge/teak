import {
  explainInvalidCardTags,
  isCardHidden,
  isHiddenTagList,
  MAX_BULK_TAGS,
  normalizeTagList,
  tagKey,
} from "@teak/convex/shared/tags";

/**
 * Every tag edit in the web app goes through here. A typed tag is trimmed and
 * lowercased, as the Apple and Android apps type it (`CardEdit.normalizeTag`),
 * and a tag that differs from one the card has only in case is the one it has,
 * as the server compares them.
 */

interface TaggedCard {
  aiTags?: readonly string[];
  isHidden?: true;
  tags?: readonly string[];
}

const hasTag = (list: readonly string[], tag: string) =>
  list.some((item) => tagKey(item) === tagKey(tag));

/** A tag as someone types it. */
export const typedTag = (value: string): string => tagKey(value);

/** Comma-separated tags as one edit names them. */
export const parseTagList = (value: string): string[] =>
  normalizeTagList(value.split(",").map(typedTag));

export const findTag = (
  tags: readonly string[] | undefined,
  tag: string
): string | undefined =>
  (tags ?? []).find((current) => tagKey(current) === tagKey(tag));

/** A card's tags once these are added; the tags it had come first. */
export const tagsWithAdded = (
  current: readonly string[] | undefined,
  added: readonly string[]
): string[] => {
  const tags = [...(current ?? [])];
  for (const tag of normalizeTagList(added)) {
    if (!hasTag(tags, tag)) {
      tags.push(tag);
    }
  }
  return tags;
};

export const tagsWithout = (
  current: readonly string[] | undefined,
  removed: readonly string[]
): string[] => (current ?? []).filter((tag) => !hasTag(removed, tag));

export type AddTagResult =
  | { kind: "empty" }
  | { existing: string; kind: "exists" }
  | { kind: "invalid"; message: string }
  | { hides: boolean; kind: "add"; tag: string; tags: string[] };

/**
 * What adding a typed tag to a card does. `invalid` carries the server's
 * English message, which `useServerErrors().byEnglishMessage` translates.
 * `hides` says the tag hides a card that was showing.
 */
export const addTagToCard = (card: TaggedCard, input: string): AddTagResult => {
  const tag = typedTag(input);
  if (!tag) {
    return { kind: "empty" };
  }
  const current = [...(card.tags ?? [])];
  const existing = findTag(current, tag);
  if (existing) {
    return { existing, kind: "exists" };
  }
  const tags = [...current, tag];
  const message = explainInvalidCardTags(tags, current);
  if (message) {
    return { kind: "invalid", message };
  }
  return {
    hides: !isCardHidden(card) && isHiddenTagList([tag]),
    kind: "add",
    tag,
    tags,
  };
};

/** Why a bulk edit can't name these tags, as the server checks it. */
export const explainInvalidTagEdit = (
  tags: readonly string[],
  mode: "add" | "remove"
): { kind: "tooLong" } | { kind: "tooMany" } | null => {
  if (tags.length > MAX_BULK_TAGS) {
    return { kind: "tooMany" };
  }
  // Removing names tags a card already has, older long ones included.
  if (mode === "add" && explainInvalidCardTags(tags) !== null) {
    return { kind: "tooLong" };
  }
  return null;
};
