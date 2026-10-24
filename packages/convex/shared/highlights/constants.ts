/**
 * Highlights: passages someone marked in a link's article in Teak's reader,
 * each with an optional note. The limits every surface shares.
 */

/** The most highlights one card holds. */
export const MAX_HIGHLIGHTS_PER_CARD = 200;
/** The longest highlight, in characters. */
export const MAX_HIGHLIGHT_QUOTE_CHARS = 5000;
/** The longest note on a highlight, in characters. */
export const MAX_HIGHLIGHT_NOTE_CHARS = 2000;
/** The note field shows its count from this many characters. */
export const HIGHLIGHT_NOTE_COUNTER_FROM = 1800;
/** The text kept before and after a highlight to find it again. */
export const HIGHLIGHT_CONTEXT_CHARS = 32;

/** Where a highlight was made. */
export const HIGHLIGHT_SOURCES = ["reader", "api", "import"] as const;
export type HighlightSource = (typeof HIGHLIGHT_SOURCES)[number];

/** Characters as people count them: one per code point. */
export const highlightLength = (text: string): number =>
  Array.from(text).length;

/** A note with its outer whitespace dropped; an empty one is no note. */
export const cleanHighlightNote = (
  note: string | null | undefined
): string | undefined => {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
};
