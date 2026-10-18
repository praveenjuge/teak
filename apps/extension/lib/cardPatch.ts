import { MAX_TAG_NAME_LENGTH, tagKey } from "@teak/convex/shared/tags";
import type { PatchCardPayload } from "../types/messages";

export const MAX_PATCH_TAGS = 100;
export const MAX_PATCH_NOTES_LENGTH = 100_000;

const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const isCardId = (value: unknown): value is string =>
  typeof value === "string" && CARD_ID.test(value);

export const isPatchCardPayload = (
  value: unknown
): value is PatchCardPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { addedTags, cardId, notes, tags } = value as Record<string, unknown>;
  const validTags =
    tags === undefined ||
    (Array.isArray(tags) &&
      tags.length <= MAX_PATCH_TAGS &&
      tags.every(
        (tag) =>
          typeof tag === "string" &&
          tag.trim().length > 0 &&
          tag.trim().length <= MAX_TAG_NAME_LENGTH
      ));
  const validAddedTags =
    addedTags === undefined ||
    (validTags &&
      Array.isArray(tags) &&
      Array.isArray(addedTags) &&
      addedTags.length <= MAX_PATCH_TAGS &&
      addedTags.every(
        (tag) =>
          typeof tag === "string" &&
          tags.some((name) => tagKey(String(name)) === tagKey(tag))
      ));
  const validNotes =
    notes === undefined ||
    notes === null ||
    (typeof notes === "string" && notes.length <= MAX_PATCH_NOTES_LENGTH);
  return (
    isCardId(cardId) &&
    validTags &&
    validAddedTags &&
    validNotes &&
    (tags !== undefined || notes !== undefined)
  );
};
