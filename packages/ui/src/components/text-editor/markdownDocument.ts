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
import { Marked, type Token, type Tokens, type TokensList } from "marked";
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

function markdownMeaning(tokens: Token[] | undefined): unknown[] {
  if (!tokens) {
    throw new Error("Missing Markdown tokens");
  }
  return tokens.flatMap((token): unknown[] => {
    switch (token.type) {
      case "space":
      case "checkbox":
        return [];
      case "paragraph":
        return [["paragraph", markdownMeaning(token.tokens)]];
      case "text":
        return token.tokens
          ? markdownMeaning(token.tokens)
          : [["text", decodeHtmlEntities(token.text)]];
      case "escape":
        return [["text", decodeHtmlEntities(token.text)]];
      case "heading":
        return [["heading", token.depth, markdownMeaning(token.tokens)]];
      case "strong":
      case "em":
      case "del":
      case "blockquote":
        return [[token.type, markdownMeaning(token.tokens)]];
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
          [
            "link",
            token.href,
            token.title ?? "",
            markdownMeaning(token.tokens),
          ],
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
              markdownMeaning(item.tokens),
            ]),
          ],
        ];
      }
      default:
        throw new Error("Unsupported Markdown");
    }
  });
}

const hasFrontmatter = (source: string) => /^---\r?\n/u.test(source);

const hasReferenceLinks = (tokens: TokensList) =>
  Object.keys(tokens.links).length > 0;

function hasUnsupportedSyntax(tokens: TokensList): boolean {
  try {
    markdownMeaning(tokens);
    return false;
  } catch {
    return true;
  }
}

function mustStayLiteral(source: string, tokens: TokensList): boolean {
  return (
    hasFrontmatter(source) ||
    hasReferenceLinks(tokens) ||
    hasUnsupportedSyntax(tokens)
  );
}

export function hasSameMarkdownMeaning(left: string, right: string): boolean {
  try {
    return (
      JSON.stringify(markdownMeaning(lexer.lexer(left))) ===
      JSON.stringify(markdownMeaning(lexer.lexer(right)))
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
  try {
    if (mustStayLiteral(source, lexer.lexer(source))) {
      return literal;
    }
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

export { type NoteCapture, prepareNoteCapture } from "./noteCapture";
