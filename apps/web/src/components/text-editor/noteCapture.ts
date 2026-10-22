import { extractUrlFromContent } from "@teak/convex/shared/utils/linkDetection";
import { Marked, type Token, type Tokens } from "marked";

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

/**
 * The composer's toast once a capture is saved. Only a link is known for sure
 * at save time; whether a note becomes a quote or a palette is decided later,
 * so anything else is just "Saved".
 */
export function noteCaptureSavedMessage(capture: NoteCapture): string {
  return capture.type !== "text" && extractUrlFromContent(capture.content).url
    ? "Link saved"
    : "Saved";
}
