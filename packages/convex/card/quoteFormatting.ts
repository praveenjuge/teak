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

export type QuoteNormalizationResult = {
  text: string;
  removedQuotes: boolean;
};

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
  if (TRAILING_ATTRIBUTION_PREFIX.has(first) || TRAILING_PAREN_PREFIX.has(first)) {
    return true;
  }

  if (TRAILING_PUNCT_ONLY.test(trimmed)) {
    return true;
  }

  return false;
};

const findClosingIndex = (value: string, closing: string): number => {
  for (let i = value.length - 1; i > 0; i--) {
    if (value[i] !== closing) {
      continue;
    }

    const trailing = value.slice(i + 1);
    if (isAllowedTrailingText(trailing)) {
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

    const closingIndex = findClosingIndex(working, closing);
    if (closingIndex === -1) {
      break;
    }

    const before = working.slice(1, closingIndex);
    const after = working.slice(closingIndex + 1);
    working = `${before}${after}`.trim();
    removed = true;

    // Continue removing if multiple decorative quote layers are present
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
