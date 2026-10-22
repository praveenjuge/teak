import {
  mayHaveCardLinks,
  replaceCardLinkTokens,
} from "@teak/convex/shared/cardLinks";
import { trimTrailingUrlPunctuation } from "@teak/convex/shared/utils/linkDetection";

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

const ESCAPED_PUNCTUATION = /\\([\\`*_{}[\]()#+\-.!~|<>&])/g;
/** Characters the strip rules read as Markdown, hidden in a link's title. */
const TITLE_PUNCTUATION = /[\\`*_{}[\]()#+\-.!~|<>]/g;
const PLACEHOLDER_BASE = "".charCodeAt(0);
/** Covers every ASCII character, so every `TITLE_PUNCTUATION` placeholder. */
const PLACEHOLDER = /[-]/g;

const toPlaceholder = (character: string) =>
  String.fromCharCode(PLACEHOLDER_BASE + character.charCodeAt(0));

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};
/** The longest entity decoded below: `&#1114111;` or `&#x10FFFF;`. */
const MAX_ENTITY_LENGTH = 10;
/** A code span or fence, whose entities stay literal, or an entity. */
const CODE_OR_ENTITY =
  /(`+)[\s\S]*?\1|&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;

const codePointText = (codePoint: number) =>
  codePoint === 0 ||
  codePoint > 0x10_ff_ff ||
  (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
    ? "�"
    : String.fromCodePoint(codePoint);

/**
 * Entities decoded in one pass, so `&amp;lt;` reads `&lt;`. The editor saves
 * `<`, `>` and `&` as `&lt;`, `&gt;` and `&amp;`. A decoded ASCII character
 * becomes a placeholder, so `&lt;b&gt;` or `&gt; text` stays literal text
 * rather than reading as a tag or a quote marker.
 */
const decodeEntities = (text: string) =>
  text.replace(
    CODE_OR_ENTITY,
    (match, code?: string, dec?: string, hex?: string, name?: string) => {
      if (code !== undefined) {
        return match;
      }
      let decoded: string | undefined;
      if (dec !== undefined) {
        decoded = codePointText(Number(dec));
      } else if (hex === undefined) {
        decoded = NAMED_ENTITIES[name ?? ""];
      } else {
        decoded = codePointText(Number.parseInt(hex, 16));
      }
      if (decoded === undefined) {
        return match;
      }
      return decoded.charCodeAt(0) < 0x80 ? toPlaceholder(decoded) : decoded;
    }
  );

/**
 * The first `maxLength` characters, stripped, with escaped punctuation and
 * entities kept literal. Both become placeholders before the cut, so it can't
 * split one. An escape or entity is at most `MAX_ENTITY_LENGTH` characters, so
 * that many times `maxLength`, plus one, of the source is enough, and one that
 * first cut splits falls past `maxLength`.
 */
function withEscapedPunctuation(
  text: string,
  maxLength: number,
  strip: (text: string) => string
): string {
  const protectedText = decodeEntities(
    text
      .slice(0, MAX_ENTITY_LENGTH * maxLength + 1)
      .replace(ESCAPED_PUNCTUATION, (_match, character: string) =>
        toPlaceholder(character)
      )
  ).slice(0, maxLength);
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

const URL_IN_TEXT = /https?:\/\/\S+/g;
const EMPTY_BRACKETS = /[([{<]\s*[)\]}>]/g;
const SPACE_BEFORE_PUNCTUATION = /\s+([.,;:!?…])/g;
const LEADING_PUNCTUATION = /^[\s.,;:!?\-–—]+/;
const DANGLING_SEPARATOR = /[\s,;:\-–—]+([.!?…]*)$/;
const HAS_WORDS = /[\p{L}\p{N}]/u;

/**
 * The words a person saved with a link, as plain text without its URLs:
 * `Read this (https://x.com/a) later` reads `Read this later`. Nothing when
 * the note is only the URL, or only repeats the link's title, as an import
 * that saves the title as the note does.
 */
export function linkNoteText(
  content: string | null | undefined,
  { maxLength, title }: { maxLength?: number; title?: string } = {}
): string | undefined {
  const plain = markdownToPlainText(content, { maxLength });
  if (!plain) {
    return;
  }
  const text = plain
    .replace(
      URL_IN_TEXT,
      (url) => ` ${url.slice(trimTrailingUrlPunctuation(url).length)}`
    )
    .replace(EMPTY_BRACKETS, " ")
    .replace(/\s+/g, " ")
    .replace(SPACE_BEFORE_PUNCTUATION, "$1")
    .trim()
    .replace(LEADING_PUNCTUATION, "")
    .replace(DANGLING_SEPARATOR, "$1");
  if (!HAS_WORDS.test(text)) {
    return;
  }
  const comparable = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (title && comparable(title) === comparable(text)) {
    return;
  }
  return text;
}
