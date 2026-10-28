import { parseDocument } from "htmlparser2";
import { MARKDOWN_CONTENT_MAX_BYTES } from "../shared/markdown";

// What a saved email becomes: a link card when the body is essentially one
// link, otherwise a Markdown text card headed by the subject. Pure: the
// inbound email route plans the cards, then creates them.

export type EmailCardPlan =
  | { kind: "link"; url: string; notes?: string }
  | { kind: "text"; markdown: string }
  | { kind: "empty" };

/** A body with one link and at most this much other text is a link card. */
const LINK_NOTES_MAX_CHARS = 280;
/** Elements nested deeper than this are read as plain text. */
const MAX_RENDER_DEPTH = 200;
const MAX_REDIRECT_UNWRAPS = 5;

// Placeholders while rendering: a <br>, and a break between blocks. Inline
// text never holds a newline, so blocks are joined once, at the end.
const BR = "\ue000";
const BLOCK = "\ue001";

const SUBJECT_PREFIX_REGEX =
  /^(?:re|fwd?|fw|wg|aw|tr|rv|sv|vs|doorst|転送|回复|答复|转发)\s*(?:\[\d+\])?\s*[:：]\s*/iu;
const WHITESPACE_REGEX = /\s+/gu;
// Soft hyphens, zero-width characters, the combining grapheme joiner
// preheaders pad with, the placeholders used while rendering, and the object
// replacement character Apple Mail leaves where an attachment sits.
const INVISIBLE_REGEX =
  /\u034f|[\u00ad\u200b-\u200d\u2060\ufeff\ue000\ue001\ufffc]/gu;
// Apple Mail's share layout (Share > Mail, or a message a script asks Mail to
// write) quotes the whole body; the sender wrote no quote.
const APPLE_SHARE_REGEX = /\bApple-Mail-URLShareWrapperClass\b/u;
const SHARE_QUOTE_REGEX = /^> ?/gmu;
const BARE_URL_REGEX = /https?:\/\/[^\s<>"'`[\]{}|\\^]+/giu;
// A link written `<https://…>`, as mail clients put one in plain text; an
// HTML body's `&lt;…&gt;` arrives with the brackets escaped.
const ANGLE_URL_REGEX = /\\?<(https?:\/\/[^\s<>\\]+)\\?>/giu;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?'"]+$/u;
const MARKDOWN_LINK_REGEX = /\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+)\)/gu;
const MARKDOWN_SPECIAL_REGEX = /[\\`*_[\]<>#|~]/gu;
const MARKDOWN_ESCAPE_REGEX = /\\([\\`*_[\]<>#|~])/gu;
const BOLD_MARKER_REGEX = /\*\*/gu;
const BLANK_LINES_REGEX = /\n{3,}/gu;
const QUOTE_PREFIX_REGEX = /^(?:>\s?)+/u;
const FORWARD_MARKER_REGEX =
  /^(?:-{3,}\s*(?:forwarded message|original message)\s*-{3,}|begin forwarded message:?)$/iu;
const SEPARATOR_REGEX = /^_{10,}$/u;
const HEADER_LINE_REGEX =
  /^(?:\*\*)?(from|date|sent|subject|to|cc|bcc|reply-to)(?:\*\*)?\s*:(?:\*\*)?(?:\s.*)?$/iu;
const MOBILE_SIGNATURE_REGEX =
  /^(?:sent from my .{1,40}|sent from (?:mail|outlook|yahoo mail)\b.{0,40}|get outlook for (?:ios|android))$/iu;
const HIDDEN_STYLE_REGEX =
  /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)/iu;
const HEADING_TAG_REGEX = /^h([1-6])$/u;
const INLINE_BREAKS_REGEX = /[\ue000\ue001\n]+/gu;
const DOUBLE_SPACES_REGEX = / {2,}/gu;
// A run of spaces or whitespace is only tried from its start (the
// lookbehinds): tried from every space, a long run took minutes.
const BR_REGEX = /(?<! ) *\ue000 */gu;
const EDGE_WHITESPACE_REGEX = /^\s+|\s+$/gu;
const URL_UNSAFE_REGEX = /[()\s]/gu;
const PRE_EDGES_REGEX = /^\n+|\s+$/gu;
const LINE_ENDINGS_REGEX = /\r\n?/gu;
const TRAILING_SPACES_REGEX = /(?<![ \t])[ \t]+$/gmu;
const FINAL_SPACES_REGEX = /(?<! ) +$/u;
const NESTED_LIST_GAP_REGEX = /\n\n(?=\s*(?:[-*+]|\d+\.) )/gu;
const SPACE_BEFORE_PUNCTUATION_REGEX = /(?<!\s)\s+([.,;:!?])/gu;
const PUNCTUATION_ONLY_REGEX = /^[\s.,;:!?()[\]"'-]*$/u;
const URL_UNSAFE_CHARS: Record<string, string> = {
  "(": "%28",
  ")": "%29",
};

const REDIRECT_PARAMS = [
  "url",
  "u",
  "q",
  "target",
  "redirect",
  "dest",
  "destination",
];
const TRACKING_PARAM_REGEX = /^(?:utm_.*|mc_cid|mc_eid)$/iu;

const SKIPPED_TAGS = new Set([
  "area",
  "audio",
  "button",
  "head",
  "iframe",
  "img",
  "input",
  "link",
  "map",
  "meta",
  "noscript",
  "object",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "video",
]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "body",
  "center",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "header",
  "html",
  "main",
  "nav",
  "p",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
]);

/** The subject without its stacked Re:, Fwd: and localized prefixes. */
export const cleanEmailSubject = (subject: string): string => {
  let cleaned = subject.replace(WHITESPACE_REGEX, " ").trim();
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(SUBJECT_PREFIX_REGEX, "").trim();
  } while (cleaned !== previous);
  return cleaned;
};

const toHttpUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

// A redirector's own path ("/url", "/r", "/track/click") or a host that only
// wraps links. A share link (`/sharer.php?u=`, `/intent/tweet?url=`) or any
// other page with a URL in its query keeps its own destination.
const REDIRECT_PATH_REGEX =
  /^\/(?:url|r|redir|redirect|click|track|link|links|out|go|c|l|ls|t|e|wf|ss|trk)(?:\/|$)/iu;
const REDIRECT_HOST_REGEX =
  /(?:^|\.)(?:safelinks\.protection\.outlook\.com|urldefense\.com|urldefense\.proofpoint\.com)$/iu;

const isRedirector = (url: URL): boolean =>
  REDIRECT_PATH_REGEX.test(url.pathname) ||
  REDIRECT_HOST_REGEX.test(url.hostname);

/** The destination a redirect wrapper carries in a query parameter. */
const redirectTarget = (url: URL): URL | null => {
  if (!isRedirector(url)) {
    return null;
  }
  for (const name of REDIRECT_PARAMS) {
    const value = url.searchParams.get(name);
    const inner = value ? toHttpUrl(value) : null;
    if (inner) {
      return inner;
    }
  }
  return null;
};

/**
 * An http(s) link with its redirect wrappers (a destination carried in a
 * query parameter: Google's /url?q=, Outlook safelinks, newsletter click
 * trackers) unwrapped and its tracking parameters dropped. Null for
 * anything that isn't http(s).
 */
export const cleanEmailLink = (raw: string): string | null => {
  let url = toHttpUrl(raw);
  if (!url) {
    return null;
  }
  for (let unwraps = 0; unwraps < MAX_REDIRECT_UNWRAPS; unwraps++) {
    const inner = redirectTarget(url);
    if (!inner) {
      break;
    }
    url = inner;
  }
  const tracking = [...url.searchParams.keys()].filter((key) =>
    TRACKING_PARAM_REGEX.test(key)
  );
  for (const key of tracking) {
    url.searchParams.delete(key);
  }
  return url.href;
};

/** A bare URL found in text, without the punctuation that ends a sentence. */
const splitTrailing = (match: string): { trailing: string; url: string } => {
  let url = match.replace(TRAILING_PUNCTUATION_REGEX, "");
  if (url.endsWith(")") && !url.includes("(")) {
    url = url.slice(0, -1);
  }
  return { trailing: match.slice(url.length), url };
};

/** Bare URLs in `text` replaced by their cleaned form. */
const cleanBareUrls = (text: string): string =>
  text.replace(BARE_URL_REGEX, (match) => {
    const { trailing, url } = splitTrailing(match);
    return `${cleanEmailLink(url) ?? url}${trailing}`;
  });

/** Text escaped for Markdown, its URLs cleaned and left unescaped. */
const escapeText = (text: string): string => {
  let output = "";
  let last = 0;
  for (const match of text.matchAll(BARE_URL_REGEX)) {
    const index = match.index ?? 0;
    const { trailing, url } = splitTrailing(match[0]);
    output += text.slice(last, index).replace(MARKDOWN_SPECIAL_REGEX, "\\$&");
    output += cleanEmailLink(url) ?? url;
    output += trailing.replace(MARKDOWN_SPECIAL_REGEX, "\\$&");
    last = index + match[0].length;
  }
  return output + text.slice(last).replace(MARKDOWN_SPECIAL_REGEX, "\\$&");
};

interface DomNode {
  attribs?: Record<string, string>;
  children?: DomNode[];
  data?: string;
  name?: string;
  type: string;
}

const isHidden = (node: DomNode): boolean => {
  const attribs = node.attribs ?? {};
  if ("hidden" in attribs || attribs["aria-hidden"] === "true") {
    return true;
  }
  if (attribs.style && HIDDEN_STYLE_REGEX.test(attribs.style)) {
    return true;
  }
  const width = Number(attribs.width);
  const height = Number(attribs.height);
  return "width" in attribs && "height" in attribs && width <= 1 && height <= 1;
};

/** Every text node under `node`, iteratively (no recursion limit). */
const textContent = (node: DomNode, keepBreaks: boolean): string => {
  let output = "";
  const stack: DomNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as DomNode;
    if (current.type === "text") {
      output += current.data ?? "";
      continue;
    }
    if (current.type !== "tag" && current.type !== "root") {
      continue;
    }
    if (current.name && SKIPPED_TAGS.has(current.name)) {
      continue;
    }
    if (keepBreaks && current.name === "br") {
      output += "\n";
      continue;
    }
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push(children[index] as DomNode);
    }
  }
  return output;
};

/** Inline content: blocks and breaks inside it become spaces. */
const inline = (content: string): string =>
  content.replace(INLINE_BREAKS_REGEX, " ").replace(DOUBLE_SPACES_REGEX, " ");

/** Wraps inline content in a marker, keeping its outer spaces outside. */
const wrapInline = (content: string, marker: string): string => {
  const flat = inline(content);
  const core = flat.trim();
  if (!core) {
    return flat;
  }
  const lead = flat.startsWith(" ") ? " " : "";
  const trail = flat.endsWith(" ") ? " " : "";
  return `${lead}${marker}${core}${marker}${trail}`;
};

const block = (content: string): string => `${BLOCK}${content}${BLOCK}`;

/** Placeholders resolved: breaks become hard breaks, blocks paragraphs. */
const finalize = (rendered: string): string =>
  rendered
    .replace(BR_REGEX, "  \n")
    .split(BLOCK)
    .map((part) => part.replace(EDGE_WHITESPACE_REGEX, ""))
    .filter((part) => part.length > 0)
    .join("\n\n");

const indentLines = (text: string, first: string, rest: string): string =>
  text
    .split("\n")
    .map((line, index) => {
      if (index === 0) {
        return `${first}${line}`;
      }
      return line ? `${rest}${line}` : line;
    })
    .join("\n");

const renderLink = (node: DomNode, depth: number): string => {
  const content = inline(renderChildren(node, depth + 1));
  const text = content.trim();
  const href = node.attribs?.href ? cleanEmailLink(node.attribs.href) : null;
  if (!href) {
    return content;
  }
  if (!text) {
    // An image-only link, a logo or a tracking banner, says nothing.
    return "";
  }
  const lead = content.startsWith(" ") ? " " : "";
  const trail = content.endsWith(" ") ? " " : "";
  const plain = text.replace(MARKDOWN_ESCAPE_REGEX, "$1");
  if (plain === href || `${plain}/` === href) {
    return `${lead}${href}${trail}`;
  }
  const target = href.replace(
    URL_UNSAFE_REGEX,
    (char) => URL_UNSAFE_CHARS[char] ?? "%20"
  );
  return `${lead}[${text}](${target})${trail}`;
};

const renderList = (node: DomNode, depth: number): string => {
  const ordered = node.name === "ol";
  let number = Number(node.attribs?.start) || 1;
  const items: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "tag" || child.name !== "li" || isHidden(child)) {
      continue;
    }
    // A list nested in an item sits right under the item's text.
    const content = finalize(renderChildren(child, depth + 1)).replace(
      NESTED_LIST_GAP_REGEX,
      "\n"
    );
    if (!content) {
      continue;
    }
    const marker = ordered ? `${number}. ` : "- ";
    number++;
    items.push(indentLines(content, marker, " ".repeat(marker.length)));
  }
  return block(items.join("\n"));
};

const renderTableRow = (node: DomNode, depth: number): string => {
  const cells = (node.children ?? [])
    .filter(
      (child) =>
        child.type === "tag" &&
        (child.name === "td" || child.name === "th") &&
        !isHidden(child)
    )
    .map((cell) => finalize(renderChildren(cell, depth + 1)))
    .filter((cell) => cell.length > 0);
  // A row of short cells is data; cells holding paragraphs are layout.
  if (cells.every((cell) => !cell.includes("\n"))) {
    return block(cells.join(" | "));
  }
  return block(cells.join(BLOCK));
};

const renderElement = (node: DomNode, depth: number): string => {
  const name = node.name ?? "";
  if (SKIPPED_TAGS.has(name) || isHidden(node)) {
    return "";
  }
  if (depth > MAX_RENDER_DEPTH) {
    return escapeText(textContent(node, false).replace(WHITESPACE_REGEX, " "));
  }
  const heading = HEADING_TAG_REGEX.exec(name);
  if (heading) {
    const text = inline(renderChildren(node, depth + 1)).trim();
    return text ? block(`${"#".repeat(Number(heading[1]))} ${text}`) : "";
  }
  switch (name) {
    case "br":
      return BR;
    case "hr":
      return block("---");
    case "a":
      return renderLink(node, depth);
    case "strong":
    case "b":
      return wrapInline(renderChildren(node, depth + 1), "**");
    case "em":
    case "i":
      return wrapInline(renderChildren(node, depth + 1), "*");
    case "s":
    case "strike":
    case "del":
      return wrapInline(renderChildren(node, depth + 1), "~~");
    case "code": {
      const code = textContent(node, false)
        .replace(WHITESPACE_REGEX, " ")
        .trim();
      if (!code) {
        return "";
      }
      const fence = code.includes("`") ? "``" : "`";
      return `${fence}${code.startsWith("`") ? " " : ""}${code}${code.endsWith("`") ? " " : ""}${fence}`;
    }
    case "pre": {
      const code = textContent(node, true)
        .replace(INVISIBLE_REGEX, "")
        .replace(PRE_EDGES_REGEX, "");
      if (!code) {
        return "";
      }
      const fence = code.includes("```") ? "~~~~" : "```";
      return block(`${fence}\n${code}\n${fence}`);
    }
    case "ul":
    case "ol":
      return renderList(node, depth);
    case "li":
      return block(
        indentLines(finalize(renderChildren(node, depth + 1)), "- ", "  ")
      );
    case "blockquote": {
      const quoted = finalize(renderChildren(node, depth + 1));
      return quoted
        ? block(
            quoted
              .split("\n")
              .map((line) => (line ? `> ${line}` : ">"))
              .join("\n")
          )
        : "";
    }
    case "tr":
      return renderTableRow(node, depth);
    case "td":
    case "th":
      return block(renderChildren(node, depth + 1));
    default:
      return BLOCK_TAGS.has(name)
        ? block(renderChildren(node, depth + 1))
        : renderChildren(node, depth + 1);
  }
};

function renderChildren(node: DomNode, depth: number): string {
  let output = "";
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      output += escapeText(
        (child.data ?? "")
          .replace(INVISIBLE_REGEX, "")
          .replace(WHITESPACE_REGEX, " ")
      );
    } else if (child.type === "tag") {
      output += renderElement(child, depth);
    } else if (child.type === "root") {
      output += renderChildren(child, depth + 1);
    }
  }
  return output;
}

/** An HTML body as Markdown. */
export const htmlToMarkdown = (html: string): string => {
  const document = parseDocument(html, {
    decodeEntities: true,
  }) as unknown as DomNode;
  return finalize(renderChildren(document, 0));
};

const unquoted = (line: string): string =>
  line.replace(QUOTE_PREFIX_REGEX, "").trim();

const isHeaderLine = (line: string): boolean =>
  HEADER_LINE_REGEX.test(unquoted(line));

const nextContentLine = (lines: string[], from: number): number => {
  let index = from;
  while (index < lines.length && !unquoted(lines[index] as string)) {
    index++;
  }
  return index;
};

/** Whether an Outlook header run (From, then Sent or Date, and Subject) starts here. */
const isOutlookHeaderRun = (lines: string[], start: number): boolean => {
  const first = HEADER_LINE_REGEX.exec(unquoted(lines[start] as string));
  if (first?.[1]?.toLowerCase() !== "from") {
    return false;
  }
  const names = new Set<string>();
  for (
    let index = start + 1;
    index < Math.min(lines.length, start + 7);
    index++
  ) {
    const match = HEADER_LINE_REGEX.exec(unquoted(lines[index] as string));
    if (match?.[1]) {
      names.add(match[1].toLowerCase());
    }
  }
  return (names.has("sent") || names.has("date")) && names.has("subject");
};

/**
 * The forwarded-message header blocks (Gmail, Apple Mail, Outlook,
 * Thunderbird) and phone signatures, removed line by line.
 */
const removeForwardHeaders = (body: string): string => {
  const lines = body.split("\n");
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const bare = unquoted(line).replace(BOLD_MARKER_REGEX, "");
    let headerStart = -1;
    if (FORWARD_MARKER_REGEX.test(bare)) {
      headerStart = index + 1;
    } else if (SEPARATOR_REGEX.test(bare)) {
      const next = nextContentLine(lines, index + 1);
      if (next < lines.length && isHeaderLine(lines[next] as string)) {
        headerStart = next;
      }
    } else if (isOutlookHeaderRun(lines, index)) {
      headerStart = index;
    }
    if (headerStart >= 0) {
      index = headerStart;
      // The header lines, and the blank lines between them.
      while (index < lines.length) {
        const current = lines[index] as string;
        if (isHeaderLine(current) || !unquoted(current)) {
          index++;
          continue;
        }
        break;
      }
      continue;
    }
    if (!MOBILE_SIGNATURE_REGEX.test(bare)) {
      kept.push(line);
    }
    index++;
  }
  return kept
    .join("\n")
    .replace(TRAILING_SPACES_REGEX, (spaces) => (spaces === "  " ? spaces : ""))
    .replace(BLANK_LINES_REGEX, "\n\n")
    .replace(FINAL_SPACES_REGEX, "")
    .trim();
};

/** A plain-text body: its signature cut, its links cleaned. */
const plainTextBody = (text: string): string => {
  const lines = text.replace(LINE_ENDINGS_REGEX, "\n").split("\n");
  const signature = lines.indexOf("-- ");
  const body = (signature >= 0 ? lines.slice(0, signature) : lines).join("\n");
  return cleanBareUrls(body.replace(INVISIBLE_REGEX, ""));
};

/**
 * Apple Mail's share quote, removed only when it covers every written line:
 * a reply that quotes an earlier share keeps its quotes.
 */
const unquoteAppleShare = (body: string, html: string | null): string => {
  if (!(html && APPLE_SHARE_REGEX.test(html))) {
    return body;
  }
  const written = body.split("\n").filter((line) => line.trim());
  return written.length > 0 && written.every((line) => line.startsWith(">"))
    ? body.replace(SHARE_QUOTE_REGEX, "")
    : body;
};

/** The body as cleaned Markdown: the text part when it says anything. */
const emailBody = (text: string | null, html: string | null): string => {
  const plain = text
    ? plainTextBody(
        unquoteAppleShare(
          text.replace(LINE_ENDINGS_REGEX, "\n").replace(INVISIBLE_REGEX, ""),
          html
        )
      )
    : "";
  if (plain.trim()) {
    return removeForwardHeaders(plain);
  }
  if (html?.trim()) {
    return removeForwardHeaders(unquoteAppleShare(htmlToMarkdown(html), html));
  }
  return "";
};

/** A link card when the body is one link and at most a short note. */
const linkPlan = (body: string): EmailCardPlan | null => {
  const urls = new Set<string>();
  const withoutLinks = body.replace(
    MARKDOWN_LINK_REGEX,
    (_match, text: string, url: string) => {
      urls.add(url);
      return text;
    }
  );
  // An angle-bracketed link goes with its brackets, and the punctuation
  // that ended a bare link's sentence goes with it.
  const rest = withoutLinks
    .replace(ANGLE_URL_REGEX, (_match, url: string) => {
      urls.add(url);
      return "";
    })
    .replace(BARE_URL_REGEX, (match) => {
      urls.add(splitTrailing(match).url);
      return "";
    });
  if (urls.size !== 1) {
    return null;
  }
  const notes = rest
    .replace(MARKDOWN_ESCAPE_REGEX, "$1")
    .replace(BOLD_MARKER_REGEX, "")
    .replace(WHITESPACE_REGEX, " ")
    .replace(SPACE_BEFORE_PUNCTUATION_REGEX, "$1")
    .trim();
  if ([...notes].length > LINK_NOTES_MAX_CHARS) {
    return null;
  }
  const url = [...urls][0] as string;
  return PUNCTUATION_ONLY_REGEX.test(notes)
    ? { kind: "link", url }
    : { kind: "link", notes, url };
};

const isContinuationByte = (byte: number): boolean =>
  byte >= 0x80 && byte < 0xc0;

/** Markdown cut to the text card limit on a character boundary. */
const fitMarkdown = (markdown: string): string => {
  const bytes = new TextEncoder().encode(markdown);
  if (bytes.byteLength <= MARKDOWN_CONTENT_MAX_BYTES) {
    return markdown;
  }
  const ellipsis = "…";
  let end =
    MARKDOWN_CONTENT_MAX_BYTES - new TextEncoder().encode(ellipsis).byteLength;
  // Back up over UTF-8 continuation bytes to the start of a character.
  while (end > 0 && isContinuationByte(bytes[end] ?? 0)) {
    end--;
  }
  return `${new TextDecoder().decode(bytes.subarray(0, end))}${ellipsis}`;
};

/** What a saved email becomes. */
export const planEmailCards = (email: {
  html: string | null;
  subject: string | null;
  text: string | null;
}): EmailCardPlan => {
  const body = emailBody(email.text, email.html);
  if (body) {
    const link = linkPlan(body);
    if (link) {
      return link;
    }
  }
  // biome-ignore lint/plugin: an email's subject line, not an auth identity.
  const subject = cleanEmailSubject(email.subject ?? "");
  if (!(body || subject)) {
    return { kind: "empty" };
  }
  const heading = subject ? `# ${escapeText(subject)}` : "";
  return {
    kind: "text",
    markdown: fitMarkdown(
      [heading, body].filter((part) => part.length > 0).join("\n\n")
    ),
  };
};
