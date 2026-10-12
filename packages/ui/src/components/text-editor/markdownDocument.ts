import {
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
} from "@teak/convex/shared/markdown";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { decodeHtmlEntities, getSchema, type JSONContent } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type Token, type Tokens } from "marked";
import { LiteralMarkdown } from "./LiteralMarkdown";

export function documentExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: isSafeExternalUrl,
      },
    }),
    LiteralMarkdown,
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

const lexer = new Marked({ gfm: true });
const extensions = documentExtensions();
const schema = getSchema(extensions);
export const markdownManager = new MarkdownManager({ extensions });

// Compare independently parsed Markdown semantics, not Tiptap JSON. Unknown
// syntax fails closed before the rich parser gets a chance to discard it.
function semantics(tokens: Token[] | undefined): unknown[] {
  if (!tokens) {
    throw new Error("Missing Markdown tokens");
  }
  return tokens.flatMap((token): unknown[] => {
    switch (token.type) {
      case "space":
      case "checkbox":
        return [];
      case "paragraph":
        return [["paragraph", semantics(token.tokens)]];
      case "text":
        return token.tokens
          ? semantics(token.tokens)
          : [["text", decodeHtmlEntities(token.text)]];
      case "escape":
        return [["text", decodeHtmlEntities(token.text)]];
      case "heading":
        return [["heading", token.depth, semantics(token.tokens)]];
      case "strong":
      case "em":
      case "del":
      case "blockquote":
        return [[token.type, semantics(token.tokens)]];
      case "codespan":
        return [["codespan", token.text]];
      case "code":
        return [["code", token.lang ?? "", token.text]];
      case "br":
      case "hr":
        return [[token.type]];
      case "link":
        if (!isSafeExternalUrl(token.href)) {
          throw new Error("Unsafe link");
        }
        return [
          ["link", token.href, token.title ?? "", semantics(token.tokens)],
        ];
      case "list": {
        const list = token as Tokens.List;
        return [
          [
            "list",
            list.ordered,
            list.start,
            list.items.map((item) => [
              item.task,
              item.checked ?? false,
              semantics(item.tokens),
            ]),
          ],
        ];
      }
      default:
        throw new Error("Unsupported Markdown");
    }
  });
}

export function hasSameMarkdownMeaning(left: string, right: string): boolean {
  try {
    return (
      JSON.stringify(semantics(lexer.lexer(left))) ===
      JSON.stringify(semantics(lexer.lexer(right)))
    );
  } catch {
    return false;
  }
}

export interface MarkdownDocument {
  document: JSONContent;
  literal: boolean;
}

export function prepareMarkdownDocument(source: string): MarkdownDocument {
  const literal: MarkdownDocument = {
    literal: true,
    document: {
      type: "doc",
      content: [
        {
          type: "literalMarkdown",
          content: source ? [{ type: "text", text: source }] : [],
        },
      ],
    },
  };
  if (markdownContentByteLength(source) > MARKDOWN_CONTENT_MAX_BYTES) {
    return literal;
  }
  if (!source.trim()) {
    return {
      literal: false,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    };
  }
  // Frontmatter and image references stay verbatim as literal text. Images
  // and raw HTML are never mounted, fetched, or passed to an HTML parser.
  if (/^---\r?\n/u.test(source)) {
    return literal;
  }
  try {
    const tokens = lexer.lexer(source);
    if (Object.keys(tokens.links).length) {
      return literal;
    }
    semantics(tokens);
    const document = markdownManager.parse(source);
    schema.nodeFromJSON(document).check();
    if (!hasSameMarkdownMeaning(source, markdownManager.serialize(document))) {
      return literal;
    }
    return { literal: false, document };
  } catch {
    return literal;
  }
}

export function isWithinMarkdownLimit(value: string): boolean {
  return markdownContentByteLength(value) <= MARKDOWN_CONTENT_MAX_BYTES;
}

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

/** Keep bare URL/color/quote capture, but never classify an authored Markdown
 * document as a link card just because it contains a link. A note that is only
 * a link showing its own address is captured as that bare URL. */
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
