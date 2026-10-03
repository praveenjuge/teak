export const MAX_CARD_TITLE_LENGTH = 512;

/** Undefined means invalid; null clears the title. */
export const parseCardTitle = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const title = value.trim();
  if (title.length > MAX_CARD_TITLE_LENGTH) {
    return undefined;
  }
  return title || null;
};
