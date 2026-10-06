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

/** Keep bare URL/color/quote capture, but never classify an authored Markdown
 * document as a link card just because it contains a link. */
export function shouldSaveAsMarkdownNote(source: string): boolean {
  const tokens = lexer.lexer(source).filter((token) => token.type !== "space");
  if (tokens.length === 1 && tokens[0]?.type === "blockquote") {
    return false;
  }
  if (tokens.length > 1) {
    return true;
  }
  const token = tokens[0];
  if (!token) {
    return false;
  }
  if (token.type !== "paragraph") {
    return true;
  }
  return (token.tokens ?? []).some(
    (inline: Token) =>
      !(
        ["text", "escape"].includes(inline.type) ||
        (inline.type === "link" && inline.raw === inline.href)
      )
  );
}
