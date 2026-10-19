import {
  mayHaveCardLinks,
  replaceCardLinkTokens,
} from "@teak/convex/shared/cardLinks";

const MAX_PREVIEW_LENGTH = 500;
/** Room for links' ids, which drop out when shown as titles. */
const CARD_LINK_SLACK = 8192;

interface StripRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const BLOCK_RULES: readonly StripRule[] = [
  { name: "htmlComment", pattern: /<!--[\s\S]*?-->/g, replacement: " " },
  { name: "codeFence", pattern: /^\s*(?:```|~~~).*$/gm, replacement: " " },
  {
    name: "imageKeepingAlt",
    pattern: /!\[([^\]]*)\]\([^)]*\)/g,
    replacement: "$1",
  },
  {
    name: "inlineLinkKeepingLabel",
    pattern: /\[([^\]]*)\]\([^)]*\)/g,
    replacement: "$1",
  },
  {
    name: "referenceLinkKeepingLabel",
    pattern: /\[([^\]]*)\]\[[^\]]*\]/g,
    replacement: "$1",
  },
  { name: "htmlTag", pattern: /<\/?[a-zA-Z][^>]*>/g, replacement: " " },
];

const LINE_MARKER_RULES: readonly StripRule[] = [
  { name: "headingMarker", pattern: /^#{1,6}\s+/, replacement: "" },
  { name: "nestedBlockquoteMarker", pattern: /^(?:>\s?)+/, replacement: "" },
  { name: "taskCheckbox", pattern: /^[-*+]\s+\[[ xX]\]\s+/, replacement: "" },
  { name: "bulletMarker", pattern: /^[-*+]\s+/, replacement: "" },
  { name: "orderedListMarker", pattern: /^\d+[.)]\s+/, replacement: "" },
];

const INLINE_RULES: readonly StripRule[] = [
  { name: "inlineCodeKeepingText", pattern: /`([^`]+)`/g, replacement: "$1" },
  { name: "boldPair", pattern: /(\*\*|__)(.+?)\1/g, replacement: "$2" },
  { name: "italicPair", pattern: /(\*|_)(.+?)\1/g, replacement: "$2" },
  { name: "strikethroughPair", pattern: /~~(.+?)~~/g, replacement: "$1" },
  { name: "midLineHeadingRun", pattern: /\s+#{1,6}\s+/g, replacement: " " },
  { name: "whitespaceRun", pattern: /\s+/g, replacement: " " },
];

const HORIZONTAL_RULE = /^(?:[-*_]\s*){3,}$/;

const applyRules = (text: string, rules: readonly StripRule[]) =>
  rules.reduce(
    (result, rule) => result.replace(rule.pattern, rule.replacement),
    text
  );

const ESCAPED_PUNCTUATION = /\\([\\`*_{}[\]()#+\-.!~|<>])/g;
/** Characters the strip rules read as Markdown, hidden in a link's title. */
const TITLE_PUNCTUATION = /[\\`*_{}[\]()#+\-.!~|<>]/g;
const PLACEHOLDER_BASE = "".charCodeAt(0);
/** Covers every ASCII character, so every `TITLE_PUNCTUATION` placeholder. */
const PLACEHOLDER = /[-]/g;

const toPlaceholder = (character: string) =>
  String.fromCharCode(PLACEHOLDER_BASE + character.charCodeAt(0));

/**
 * The first `maxLength` characters, stripped, with escaped punctuation kept
 * literal. Escapes become placeholders before the cut, so it can't split one.
 * An escape is at most two characters, so `2 * maxLength + 1` of the source is
 * enough, and a pair that first cut splits falls past `maxLength`.
 */
function withEscapedPunctuation(
  text: string,
  maxLength: number,
  strip: (text: string) => string
): string {
  const protectedText = text
    .slice(0, 2 * maxLength + 1)
    .replace(ESCAPED_PUNCTUATION, (_match, character: string) =>
      toPlaceholder(character)
    )
    .slice(0, maxLength);
  return strip(protectedText).replace(PLACEHOLDER, (placeholder) =>
    String.fromCharCode(placeholder.charCodeAt(0) - PLACEHOLDER_BASE)
  );
}

/** The first `limit` characters, less a link token the cut splits. */
const withoutCutToken = (input: string, limit: number): string => {
  if (input.length <= limit) {
    return input;
  }
  const head = input.slice(0, limit);
  const open = head.lastIndexOf("[[");
  return open !== -1 && !head.includes("]]", open) ? head.slice(0, open) : head;
};

export function markdownToPlainText(
  input?: string | null,
  { maxLength = MAX_PREVIEW_LENGTH }: { maxLength?: number } = {}
): string {
  if (!input) {
    return "";
  }
  // `[[Title|teak:<id>]]` card links read as their titles, kept literal.
  // Placeholders keep a title's length, so the cut can't split an escape.
  const source = mayHaveCardLinks(input)
    ? replaceCardLinkTokens(
        withoutCutToken(input, maxLength + CARD_LINK_SLACK),
        (title) => title.replace(TITLE_PUNCTUATION, toPlaceholder)
      )
    : input;
  return withEscapedPunctuation(source, maxLength, (text) => {
    const lines = applyRules(text, BLOCK_RULES)
      .split(/\r?\n/)
      .map((rawLine) => {
        const line = rawLine.trim();
        return HORIZONTAL_RULE.test(line)
          ? ""
          : applyRules(line, LINE_MARKER_RULES);
      });
    return applyRules(lines.join(" "), INLINE_RULES).trim();
  });
}
