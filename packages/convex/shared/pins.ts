/** The most cards one person can pin to the top of their library. */
export const MAX_PINNED_CARDS = 12;

export const PIN_ERROR_CODES = {
  PIN_LIMIT_REACHED: "PIN_LIMIT_REACHED",
} as const;

/** The server's messages; the web app shows its own words for each code. */
export const PIN_ERROR_MESSAGES = {
  ARCHIVED: "Archived cards and cards in Trash can't be pinned",
  ORDER_MISMATCH:
    "List every pinned card exactly once, in the order you want them",
  PIN_LIMIT_REACHED: `You can pin up to ${MAX_PINNED_CARDS} cards. Unpin one first.`,
} as const;

export const isCardPinned = (card: { pinPosition?: number }): boolean =>
  card.pinPosition !== undefined;
