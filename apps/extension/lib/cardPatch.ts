import { MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
import type { PatchCardPayload } from "../types/messages";

// Read by the popup as well as the background, so it imports no sign-in code.

export const MAX_PATCH_TAGS = 100;
export const MAX_PATCH_NOTES_LENGTH = 100_000;

const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const isCardId = (value: unknown): value is string =>
  typeof value === "string" && CARD_ID.test(value);

/** A patch the background accepts from the popup: a card id and a change. */
export const isPatchCardPayload = (
  value: unknown
): value is PatchCardPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { cardId, notes, tags } = value as Record<string, unknown>;
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
  const validNotes =
    notes === undefined ||
    notes === null ||
    (typeof notes === "string" && notes.length <= MAX_PATCH_NOTES_LENGTH);
  return (
    isCardId(cardId) &&
    validTags &&
    validNotes &&
    (tags !== undefined || notes !== undefined)
  );
};
