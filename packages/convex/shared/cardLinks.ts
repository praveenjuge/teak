// `[[Title|teak:<cardId>]]` links between cards, written in a text card's
// Markdown. The id is the link; the title is only a readable fallback, since
// every surface shows the target's current title.

export const CARD_LINK_TITLE_MAX_LENGTH = 200;
/** Distinct targets indexed per card; later ones still render. */
export const MAX_CARD_LINKS = 500;

const TOKEN_SOURCE = String.raw`\[\[([^\]|\n]{0,200})\|teak:([a-z0-9]{16,64})\]\]`;
export const CARD_LINK_PATTERN = new RegExp(TOKEN_SOURCE);
const TOKEN_REGEX = new RegExp(TOKEN_SOURCE, "g");
const TITLE_UNSAFE_REGEX = /[|\]\r\n]+/g;
const SPACES_REGEX = /\s+/g;
const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})/;
/** A closing fence has nothing after it: "```js" inside a block is code. */
const CLOSING_FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const BACKTICK_RUN_REGEX = /`+/g;
const LEADING_SPACE_REGEX = /^[ \t]+/;
const LIST_ITEM_REGEX = /^( *)([-+*]|\d{1,9}[.)])( {1,4}|$)/;
const CODE_INDENT = 4;
const ELLIPSIS = "…";
const FALLBACK_TITLE = "Card";

/** Whether `markdown` might hold a link token: a cheap check before parsing. */
export const mayHaveCardLinks = (markdown: string | undefined): boolean =>
  typeof markdown === "string" && markdown.includes("|teak:");

type GraphemeSegmenter = new (
  locale: undefined,
  options: { granularity: "grapheme" }
) => { segment: (value: string) => Iterable<{ segment: string }> };

// Not in every runtime's lib types; code points are the fallback.
const Segmenter = (globalThis as { Intl?: { Segmenter?: GraphemeSegmenter } })
  .Intl?.Segmenter;

const graphemes = (value: string): string[] =>
  Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "grapheme" }).segment(value),
        (part) => part.segment
      )
    : Array.from(value);

/** `title` cut to `max` UTF-16 units on a whole grapheme, ending in `…`. */
const truncateTitle = (title: string, max: number): string => {
  if (title.length <= max) {
    return title;
  }
  let result = "";
  for (const part of graphemes(title)) {
    if (result.length + part.length + ELLIPSIS.length > max) {
      break;
    }
    result += part;
  }
  return `${result.trimEnd()}${ELLIPSIS}`;
};

/** A card title made fit to store in a token: one line, 200 units at most. */
export const cardLinkTokenTitle = (title: string): string => {
  const safe = title
    .replace(TITLE_UNSAFE_REGEX, " ")
    .replace(SPACES_REGEX, " ")
    .trim();
  return truncateTitle(safe || FALLBACK_TITLE, CARD_LINK_TITLE_MAX_LENGTH);
};

/** A token that always matches the parse pattern, whatever the title. */
export const formatCardLinkToken = (title: string, id: string): string =>
  `[[${cardLinkTokenTitle(title)}|teak:${id}]]`;

const blank = (text: string) => text.replace(/[^\n]/g, " ");

/** Inline code spans in one line replaced by spaces, keeping every index. */
const maskCodeSpans = (line: string): string => {
  const runs = Array.from(line.matchAll(BACKTICK_RUN_REGEX));
  let masked = line;
  for (let index = 0; index < runs.length; index++) {
    const open = runs[index];
    const closeIndex = runs.findIndex(
      (run, at) => at > index && run[0].length === open[0].length
    );
    if (closeIndex === -1) {
      continue;
    }
    const close = runs[closeIndex];
    const start = open.index ?? 0;
    const end = (close.index ?? 0) + close[0].length;
    masked =
      masked.slice(0, start) +
      blank(masked.slice(start, end)) +
      masked.slice(end);
    index = closeIndex;
  }
  return masked;
};

/**
 * `markdown` with fenced code blocks, indented code blocks and inline code
 * spans replaced by spaces, so every index still points at the original.
 */
const maskCode = (markdown: string): string => {
  const lines = markdown.split("\n");
  let fence: string | null = null;
  let previousBlank = true;
  let inIndented = false;
  // Where the open list item's text starts; its lines indented less than
  // four more than that are the item's paragraphs, not code.
  let listContent = 0;
  return lines
    .map((line) => {
      if (fence) {
        const closing = CLOSING_FENCE_REGEX.exec(line);
        if (
          closing &&
          closing[1][0] === fence[0] &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return blank(line);
      }
      const fenceMatch = FENCE_REGEX.exec(line);
      if (fenceMatch) {
        fence = fenceMatch[1];
        return blank(line);
      }
      const isBlank = line.trim() === "";
      const expanded = line.replace(LEADING_SPACE_REGEX, (space) =>
        space.replaceAll("\t", "    ")
      );
      const columns = expanded.length - expanded.trimStart().length;
      inIndented =
        !isBlank &&
        columns >= listContent + CODE_INDENT &&
        (inIndented || previousBlank);
      if (!(isBlank || inIndented)) {
        const item = LIST_ITEM_REGEX.exec(expanded);
        if (item && item[1].length < listContent + CODE_INDENT) {
          listContent = item[0].length + (item[3] ? 0 : 1);
        } else if (previousBlank && columns < listContent) {
          listContent = 0;
        }
      }
      previousBlank = isBlank;
      return inIndented ? blank(line) : maskCodeSpans(line);
    })
    .join("\n");
};

interface CardLinkMatch {
  end: number;
  id: string;
  start: number;
  title: string;
}

const findCardLinks = (markdown: string): CardLinkMatch[] => {
  if (!mayHaveCardLinks(markdown)) {
    return [];
  }
  const masked = maskCode(markdown);
  return Array.from(masked.matchAll(TOKEN_REGEX), (match) => {
    const start = match.index;
    // The title comes from the original: masking blanks backticks in it.
    const titleStart = start + "[[".length;
    return {
      end: start + match[0].length,
      id: match[2],
      start,
      title: markdown.slice(titleStart, titleStart + match[1].length),
    };
  });
};

/** Linked card ids in order, unique, at most `MAX_CARD_LINKS`; code excluded. */
export const parseCardLinkIds = (markdown: string | undefined): string[] => {
  const ids = new Set<string>();
  for (const { id } of findCardLinks(markdown ?? "")) {
    if (ids.size >= MAX_CARD_LINKS) {
      break;
    }
    ids.add(id);
  }
  return Array.from(ids);
};

/** Every token outside code replaced by `replace(title, id)`. */
export const replaceCardLinkTokens = (
  markdown: string,
  replace: (title: string, id: string) => string
): string => {
  const matches = findCardLinks(markdown);
  if (matches.length === 0) {
    return markdown;
  }
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result +=
      markdown.slice(cursor, match.start) + replace(match.title, match.id);
    cursor = match.end;
  }
  return result + markdown.slice(cursor);
};

/** Tokens shown as their stored titles, for previews and search text. */
export const cardLinkTokensToText = (markdown: string): string =>
  replaceCardLinkTokens(markdown, (title) => title);
