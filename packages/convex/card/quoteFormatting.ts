import type { Doc } from "../shared/types";

const OPENING_QUOTE_TO_CLOSING = new Map<string, string>([
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["＂", "＂"],
  ["“", "”"],
  ["„", "“"],
  ["‘", "’"],
  ["‚", "‘"],
  ["❝", "❞"],
  ["❛", "❜"],
  ["«", "»"],
  ["‹", "›"],
  ["｢", "｣"],
  ["「", "」"],
  ["『", "』"],
  ["《", "》"],
  ["〈", "〉"],
  ["〝", "〞"],
  ["﹁", "﹂"],
  ["﹃", "﹄"],
]);

const SYMMETRIC_QUOTES = new Set(['"', "'", "`", "＂"]);

const TRAILING_ATTRIBUTION_PREFIX = new Set(["—", "-", "–", "―", "~"]);
const TRAILING_PAREN_PREFIX = new Set(["(", "[", "{"]);
const TRAILING_PUNCT_ONLY = /^[\s.,!?;:…·、。！？；：•]+$/u;

export interface QuoteNormalizationResult {
  removedQuotes: boolean;
  text: string;
}

const getClosingChar = (char: string): string | undefined => {
  if (OPENING_QUOTE_TO_CLOSING.has(char)) {
    return OPENING_QUOTE_TO_CLOSING.get(char);
  }

  if (SYMMETRIC_QUOTES.has(char)) {
    return char;
  }

  return undefined;
};

const isAllowedTrailingText = (text: string): boolean => {
  if (!text) {
    return true;
  }

  if (!text.trim()) {
    return true;
  }

  const trimmed = text.trimStart();
  if (!trimmed) {
    return true;
  }

  const first = trimmed[0];
  if (
    TRAILING_ATTRIBUTION_PREFIX.has(first) ||
    TRAILING_PAREN_PREFIX.has(first)
  ) {
    return true;
  }

  if (TRAILING_PUNCT_ONLY.test(trimmed)) {
    return true;
  }

  return false;
};

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const SPACE_CHAR = /\s/;

/**
 * Whether `inner` closes the quote and opens another, as in `"Yes" and "No"`,
 * so the outer marks belong to two quotes. A quote between letters, as in
 * "it's", or escaped with a backslash is not a quote mark.
 */
const closesAndReopens = (
  inner: string,
  opening: string,
  closing: string
): boolean => {
  let closed = false;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    const previous = inner[i - 1];
    const next = inner[i + 1];
    if (previous === "\\" || (char !== opening && char !== closing)) {
      continue;
    }
    if (opening !== closing) {
      if (char === closing) {
        closed = true;
      } else if (closed) {
        return true;
      }
      continue;
    }
    if (closed) {
      if (
        !(previous && WORD_CHAR.test(previous)) &&
        next &&
        !SPACE_CHAR.test(next)
      ) {
        return true;
      }
    } else if (
      previous &&
      !SPACE_CHAR.test(previous) &&
      !(next && WORD_CHAR.test(next))
    ) {
      closed = true;
    }
  }
  return false;
};

const findClosingIndex = (
  value: string,
  opening: string,
  closing: string
): number => {
  for (let i = value.length - 1; i > 0; i--) {
    if (value[i] !== closing) {
      continue;
    }

    const trailing = value.slice(i + 1);
    if (
      isAllowedTrailingText(trailing) &&
      !closesAndReopens(value.slice(1, i), opening, closing)
    ) {
      return i;
    }
  }

  return -1;
};

export const normalizeQuoteContent = (
  content?: string | null
): QuoteNormalizationResult => {
  const original = typeof content === "string" ? content : "";
  let working = original.trim();

  if (working.length < 2) {
    return { text: original, removedQuotes: false };
  }

  let removed = false;

  while (working.length > 1) {
    const first = working[0];
    const closing = getClosingChar(first);
    if (!closing) {
      break;
    }

    const closingIndex = findClosingIndex(working, first, closing);
    if (closingIndex === -1) {
      break;
    }

    const before = working.slice(1, closingIndex);
    const after = working.slice(closingIndex + 1);
    working = `${before}${after}`.trim();
    removed = true;
  }

  return {
    text: removed ? working : original,
    removedQuotes: removed,
  };
};

export const stripSurroundingQuotes = (text: string): string =>
  normalizeQuoteContent(text).text;

export const applyQuoteDisplayFormatting = <T extends Doc<"cards">>(
  card: T
): T => {
  const normalization = normalizeQuoteContent(card.content ?? "");
  const shouldFormat = card.type === "quote" || normalization.removedQuotes;

  if (!shouldFormat || normalization.text === card.content) {
    return card;
  }

  return { ...card, content: normalization.text } as T;
};

export const applyQuoteFormattingToList = <T extends Doc<"cards">>(
  cards: T[]
): T[] => cards.map(applyQuoteDisplayFormatting);
