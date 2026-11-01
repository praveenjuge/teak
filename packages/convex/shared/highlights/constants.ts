export const MAX_HIGHLIGHTS_PER_CARD = 200;
export const MAX_HIGHLIGHT_QUOTE_CHARS = 5000;
export const MAX_HIGHLIGHT_NOTE_CHARS = 2000;
export const HIGHLIGHT_NOTE_COUNTER_FROM = 1800;
export const HIGHLIGHT_CONTEXT_CHARS = 32;

export const HIGHLIGHT_SOURCES = ["reader", "api", "import"] as const;
export type HighlightSource = (typeof HIGHLIGHT_SOURCES)[number];

export const highlightLength = (text: string): number =>
  Array.from(text).length;

export const cleanHighlightNote = (
  note: string | null | undefined
): string | undefined => {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
};
