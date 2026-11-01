import { extractUrlFromContent } from "@teak/convex/shared/utils/linkDetection";
import {
  isSafeExternalUrl,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { urlKey } from "@teak/convex/shared/utils/urlKey";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { Marked, type Token, type Tokens } from "marked";

const englishTextEditor = createTeakTranslator(
  "en",
  englishMessages,
  "textEditor"
);

const lexer = new Marked({ gfm: true });

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  gt: ">",
  lt: "<",
  quot: '"',
};

const codePointText = (codePoint: number) =>
  codePoint === 0 ||
  codePoint > 0x10_ff_ff ||
  (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
    ? "\uFFFD"
    : String.fromCodePoint(codePoint);

/** The entities the editor writes into a link's label, decoded in one pass
 * as Tiptap decodes them (a URL label never holds the C1 controls Tiptap
 * also remaps). */
const decodeHtmlEntities = (text: string) =>
  text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(lt|gt|quot|amp));/g,
    (_match, dec?: string, hex?: string, name?: string) => {
      if (dec !== undefined) {
        return codePointText(Number(dec));
      }
      if (hex !== undefined) {
        return codePointText(Number.parseInt(hex, 16));
      }
      return NAMED_ENTITIES[name ?? ""] ?? "";
    }
  );

export interface NoteCapture {
  content: string;
  type?: "text";
}

function isPlainText(token: Token): token is Tokens.Text | Tokens.Escape {
  return token.type === "text" || token.type === "escape";
}

// The editor turns a pasted URL into a link that shows its own address, which
// serializes as `[https://…](https://…)`.
function selfLinkHref(token: Token | undefined): string | undefined {
  if (token?.type !== "link" || token.title) {
    return undefined;
  }
  const label: Token[] = token.tokens ?? [];
  if (!label.every(isPlainText)) {
    return undefined;
  }
  const text = label.map((child) => decodeHtmlEntities(child.text)).join("");
  return text === token.href ? token.href : undefined;
}

export function prepareNoteCapture(source: string): NoteCapture {
  const tokens = lexer.lexer(source).filter((token) => token.type !== "space");
  const token = tokens[0];
  if (!token || (tokens.length === 1 && token.type === "blockquote")) {
    return { content: source };
  }
  if (tokens.length > 1 || token.type !== "paragraph") {
    return { content: source, type: "text" };
  }
  const inline: Token[] = token.tokens ?? [];
  const href = inline.length === 1 ? selfLinkHref(inline[0]) : undefined;
  if (href) {
    return { content: href };
  }
  const authored = inline.some(
    (child) =>
      !(
        isPlainText(child) ||
        (child.type === "link" && child.raw === child.href)
      )
  );
  return authored ? { content: source, type: "text" } : { content: source };
}

const LINK_LINE_START = /^\s*(?:[-*+]\s+|\d{1,9}[.)]\s+)?[<[]?https?:\/\//i;
const URL_ONLY = /^https?:\/\/\S+$/i;
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

type LinePart =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string };

function lineUrl(parts: LinePart[]): string | null {
  const urls = parts.filter((part) => part.kind === "url");
  if (urls.length > 0) {
    const onlyUrl =
      urls.length === 1 &&
      parts.every((part) => part.kind === "url" || !part.value.trim());
    return onlyUrl ? urls[0].value : null;
  }
  const text = decodeHtmlEntities(
    parts
      .map((part) => part.value)
      .join("")
      .replace(MARKDOWN_ESCAPE, "$1")
      .trim()
      // A backslash ending a line is a hard break, not part of the URL.
      .replace(/\\$/, "")
  );
  return URL_ONLY.test(text) && isSafeExternalUrl(text) ? text : null;
}

function inlineLinkLines(tokens: Token[]): string[] | null {
  const lines: string[] = [];
  let parts: LinePart[] = [];
  const endLine = () => {
    if (parts.some((part) => part.value.trim())) {
      const url = lineUrl(parts);
      if (url === null) {
        return false;
      }
      lines.push(url);
    }
    parts = [];
    return true;
  };
  for (const token of tokens) {
    if (token.type === "br") {
      if (!endLine()) {
        return null;
      }
    } else if (token.type === "text") {
      const [first, ...rest] = token.raw.split("\n");
      parts.push({ kind: "text", value: first });
      for (const segment of rest) {
        if (!endLine()) {
          return null;
        }
        parts.push({ kind: "text", value: segment });
      }
    } else if (token.type === "escape") {
      parts.push({ kind: "text", value: token.raw });
    } else if (token.type === "link" && token.raw === token.text) {
      // GFM writes a bare URL as a link; its text is the URL as typed.
      parts.push({ kind: "text", value: token.raw });
    } else if (token.type === "link" && token.raw === `<${token.href}>`) {
      parts.push({ kind: "url", value: token.href });
    } else {
      const href = selfLinkHref(token);
      if (!(href && isSafeExternalUrl(href))) {
        return null;
      }
      parts.push({ kind: "url", value: href });
    }
  }
  return endLine() ? lines : null;
}

function blockLinkLines(token: Token): string[] | null {
  if (token.type === "space") {
    return [];
  }
  if (token.type === "paragraph" || token.type === "text") {
    return inlineLinkLines(
      token.tokens ?? [{ type: "text", raw: token.text, text: token.text }]
    );
  }
  if (token.type !== "list") {
    return null;
  }
  const lines: string[] = [];
  for (const item of (token as Tokens.List).items) {
    if (item.task) {
      return null;
    }
    for (const child of item.tokens) {
      const childLines = blockLinkLines(child);
      if (childLines === null) {
        return null;
      }
      lines.push(...childLines);
    }
  }
  return lines;
}

export function extractLinkList(markdown: string): string[] | null {
  const rawLines = markdown.split("\n").filter((line) => line.trim());
  if (
    rawLines.length < 2 ||
    !rawLines.every((line) => LINK_LINE_START.test(line))
  ) {
    return null;
  }
  const links: string[] = [];
  for (const token of lexer.lexer(markdown)) {
    const lines = blockLinkLines(token);
    if (lines === null) {
      return null;
    }
    links.push(...lines);
  }
  return links.length >= 2 ? uniqueLinks(links) : null;
}

/** Drops repeats the way the server does (`normalizePastedUrls`), so the
 * Save button and progress count the links that will be saved. */
function uniqueLinks(links: string[]): string[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const url = sanitizeExternalUrl(link) ?? link;
    const key = urlKey(url) ?? url;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function noteCaptureSavedMessage(
  capture: NoteCapture,
  t: TeakTranslator<"textEditor"> = englishTextEditor
): string {
  return capture.type !== "text" && extractUrlFromContent(capture.content).url
    ? t("noteCapture.linkSaved")
    : t("noteCapture.saved");
}
