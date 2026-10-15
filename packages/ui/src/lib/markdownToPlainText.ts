const MAX_PREVIEW_LENGTH = 500;

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

const ESCAPED_PUNCTUATION = /\\([\\`*_{}[\]()#+\-.!~|>])/g;
const PLACEHOLDER_BASE = "".charCodeAt(0);
const PLACEHOLDER = /[-]/g;

/**
 * Runs `strip` with backslash-escaped punctuation (`my\_file`) swapped for
 * private-use placeholders, so no rule reads an escaped marker as markup,
 * then puts the punctuation back as plain characters.
 */
function withEscapedPunctuation(
  text: string,
  strip: (text: string) => string
): string {
  const protectedText = text.replace(
    ESCAPED_PUNCTUATION,
    (_match, character: string) =>
      String.fromCharCode(PLACEHOLDER_BASE + character.charCodeAt(0))
  );
  return strip(protectedText).replace(PLACEHOLDER, (placeholder) =>
    String.fromCharCode(placeholder.charCodeAt(0) - PLACEHOLDER_BASE)
  );
}

/**
 * Convert markdown to plain text for compact card previews.
 *
 * Grid cards only show a line or two, so this favours readable text over a
 * faithful markdown render: block markers (headings, list bullets,
 * blockquotes, horizontal rules), inline emphasis, links/images, inline code,
 * HTML tags and comments are stripped, and whitespace is collapsed to single
 * spaces. Backslash escapes are shown as the literal character. Only a
 * short prefix is processed since the preview is clamped.
 */
export function markdownToPlainText(input?: string | null): string {
  if (!input) {
    return "";
  }
  return withEscapedPunctuation(input.slice(0, MAX_PREVIEW_LENGTH), (text) => {
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
