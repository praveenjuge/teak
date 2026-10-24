import type { ImportHighlightInput } from "./validate";

const QUOTE_LINE = /^\s{0,3}>\s?(.*)$/u;
const HIGHLIGHT_LINE = /^\s*highlight\s*:\s?(.*)$/iu;
const NOTE_LINE = /^\s*note\s*:\s?(.*)$/iu;

const joinLines = (lines: string[]) =>
  lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

/**
 * Omnivore's `highlights/<slug>.md`: each highlight is a `> quote` block, and
 * the lines after it, up to the next quote, are its note. Text before the
 * first quote (a heading) is skipped. Returns [] when the file has no quote.
 */
export function parseOmnivoreHighlights(
  markdown: string
): ImportHighlightInput[] {
  const highlights: ImportHighlightInput[] = [];
  let quote: string[] | null = null;
  let note: string[] = [];
  let inQuote = false;
  const flush = () => {
    if (quote) {
      const text = joinLines(quote);
      const comment = joinLines(note);
      if (text) {
        highlights.push(
          comment ? { quote: text, note: comment } : { quote: text }
        );
      }
    }
    quote = null;
    note = [];
  };
  for (const line of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const quoted = QUOTE_LINE.exec(line);
    if (quoted) {
      if (!inQuote) {
        flush();
        quote = [];
      }
      inQuote = true;
      (quote as unknown as string[]).push(quoted[1] ?? "");
      continue;
    }
    inQuote = false;
    if (quote) {
      note.push(line);
    }
  }
  flush();
  return highlights;
}

/**
 * Raindrop.io's `highlights` cell: `Highlight: …` lines, each followed by an
 * optional `Note: …`. A cell without those labels holds one highlight per
 * paragraph.
 */
export function parseRaindropHighlights(cell: string): ImportHighlightInput[] {
  const text = cell.replace(/\r\n?/gu, "\n").trim();
  if (!text) {
    return [];
  }
  const lines = text.split("\n");
  if (!lines.some((line) => HIGHLIGHT_LINE.test(line))) {
    return text
      .split(/\n\s*\n/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((quote) => ({ quote }));
  }
  const highlights: ImportHighlightInput[] = [];
  let current: { note: string[]; quote: string[] } | null = null;
  let inNote = false;
  const flush = () => {
    const quote = current ? joinLines(current.quote) : "";
    const note = current ? joinLines(current.note) : "";
    if (quote) {
      highlights.push(note ? { quote, note } : { quote });
    }
    current = null;
  };
  for (const line of lines) {
    const highlight = HIGHLIGHT_LINE.exec(line);
    if (highlight) {
      flush();
      current = { note: [], quote: [highlight[1] ?? ""] };
      inNote = false;
      continue;
    }
    const noteLine = NOTE_LINE.exec(line);
    if (noteLine && current) {
      inNote = true;
      (current as { note: string[] }).note.push(noteLine[1] ?? "");
      continue;
    }
    if (current) {
      const target = current as { note: string[]; quote: string[] };
      (inNote ? target.note : target.quote).push(line);
    }
  }
  flush();
  return highlights;
}
