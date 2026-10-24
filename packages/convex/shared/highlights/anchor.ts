/**
 * Finding a highlight in an article's text again, after the W3C Web
 * Annotation selectors: a TextQuote (the quote, with up to 32 characters of
 * context on each side) and a TextPosition hint (offsets into the text).
 *
 * The text is the article as the reader shows it, with each run of
 * whitespace collapsed to one space (`normalizeReaderText`). Offsets are
 * UTF-16 indices into it, as JavaScript strings count them. The server
 * (from the Markdown) and the web app (from the rendered reader) share
 * this code, so a highlight made in one is found in the other.
 */

import { HIGHLIGHT_CONTEXT_CHARS } from "./constants";

export interface AnchorSelector {
  prefix?: string;
  quote: string;
  /** Where the quote started last time: chooses between repeats. */
  start?: number;
  suffix?: string;
}

export interface Anchor {
  end: number;
  prefix: string;
  start: number;
  suffix: string;
}

const WHITESPACE = /\s+/gu;

/** Each run of whitespace as one space, without leading or trailing space. */
export const normalizeReaderText = (text: string): string =>
  text.replace(WHITESPACE, " ").trim();

/** The context kept before and after `[start, end)` of `text`. */
export const anchorContext = (
  text: string,
  start: number,
  end: number
): { prefix: string; suffix: string } => ({
  prefix: text.slice(Math.max(0, start - HIGHLIGHT_CONTEXT_CHARS), start),
  suffix: text.slice(end, end + HIGHLIGHT_CONTEXT_CHARS),
});

const FOLDED: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "´": "'",
  "`": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...",
};

const IS_SPACE = /\s/u;

/**
 * `text` without whitespace, with curly quotes, dashes and ellipses as
 * their plain forms and letters in lower case, plus each kept character's
 * index in `text`: a match here is a match that ignores those differences.
 */
const foldText = (text: string): { folded: string; origin: number[] } => {
  let folded = "";
  const origin: number[] = [];
  // UTF-16 units, as the offsets count them.
  for (const [index, char] of text.split("").entries()) {
    if (IS_SPACE.test(char)) {
      continue;
    }
    let mapped = FOLDED[char] ?? char;
    const lower = mapped.toLowerCase();
    if (lower.length === mapped.length) {
      mapped = lower;
    }
    folded += mapped;
    origin.push(...Array.from({ length: mapped.length }, () => index));
  }
  return { folded, origin };
};

const occurrences = (haystack: string, needle: string): number[] => {
  const found: number[] = [];
  if (!needle) {
    return found;
  }
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    found.push(from);
    from = haystack.indexOf(needle, from + 1);
  }
  return found;
};

/** How many characters of `context` agree with `text`, read outward. */
const agreement = (
  context: string,
  text: string,
  direction: "before" | "after"
): number => {
  const a = foldText(context).folded;
  const b = foldText(text).folded;
  let count = 0;
  const length = Math.min(a.length, b.length);
  for (let step = 0; step < length; step += 1) {
    const left =
      direction === "before" ? a[a.length - 1 - step] : (a[step] as string);
    const right =
      direction === "before" ? b[b.length - 1 - step] : (b[step] as string);
    if (left !== right) {
      break;
    }
    count += 1;
  }
  return count;
};

interface Candidate {
  end: number;
  start: number;
}

/** The candidate whose context agrees best, then the one nearest the hint. */
const choose = (
  text: string,
  candidates: Candidate[],
  selector: AnchorSelector
): Candidate | undefined => {
  let best: Candidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const before = text.slice(
      Math.max(0, candidate.start - HIGHLIGHT_CONTEXT_CHARS * 2),
      candidate.start
    );
    const after = text.slice(
      candidate.end,
      candidate.end + HIGHLIGHT_CONTEXT_CHARS * 2
    );
    const score =
      (selector.prefix ? agreement(selector.prefix, before, "before") : 0) +
      (selector.suffix ? agreement(selector.suffix, after, "after") : 0);
    const distance =
      selector.start === undefined
        ? 0
        : Math.abs(candidate.start - selector.start);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = candidate;
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
};

/**
 * Where `selector.quote` is in `text` (normalized reader text), or null.
 * An exact match comes first; otherwise one that ignores whitespace, curly
 * quotes, dash styles and case. Between repeats, the one whose prefix and
 * suffix agree most wins, then the one nearest `selector.start`, then the
 * first. The answer carries the context found around it.
 */
export const anchorQuote = (
  text: string,
  selector: AnchorSelector
): Anchor | null => {
  const quote = normalizeReaderText(selector.quote);
  if (!(quote && text)) {
    return null;
  }
  let candidates: Candidate[] = occurrences(text, quote).map((start) => ({
    start,
    end: start + quote.length,
  }));
  if (candidates.length === 0) {
    const haystack = foldText(text);
    const needle = foldText(quote).folded;
    candidates = occurrences(haystack.folded, needle).map((start) => ({
      start: haystack.origin[start] as number,
      end: (haystack.origin[start + needle.length - 1] as number) + 1,
    }));
  }
  const chosen = choose(text, candidates, selector);
  if (!chosen) {
    return null;
  }
  return { ...chosen, ...anchorContext(text, chosen.start, chosen.end) };
};

export interface HighlightSpan {
  end: number;
  prefix?: string;
  quote: string;
  start: number;
  suffix?: string;
}

/** Whether two highlights share at least one character. */
export const spansOverlap = (
  a: { end: number; start: number },
  b: { end: number; start: number }
): boolean => a.start < b.end && b.start < a.end;

/**
 * One highlight covering two that overlap. Each quote is the text between
 * its offsets, so the union's quote is the first one's, then the part of
 * the other past its end.
 */
export const unionSpans = (
  a: HighlightSpan,
  b: HighlightSpan
): HighlightSpan => {
  const first = a.start <= b.start ? a : b;
  const second = first === a ? b : a;
  const last = second.end > first.end ? second : first;
  const consistent = (span: HighlightSpan) =>
    span.quote.length === span.end - span.start;
  let quote = first.quote;
  if (last !== first) {
    quote =
      consistent(first) && consistent(last)
        ? first.quote + last.quote.slice(first.end - last.start)
        : `${first.quote} ${last.quote}`;
  }
  return {
    start: first.start,
    end: last.end,
    quote,
    ...(first.prefix === undefined ? {} : { prefix: first.prefix }),
    ...(last.suffix === undefined ? {} : { suffix: last.suffix }),
  };
};
