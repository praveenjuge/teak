import {
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
} from "@teak/convex/shared/markdown";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import {
  decodeHtmlEntities,
  getSchema,
  type JSONContent,
  Node,
} from "@tiptap/core";
import {
  renderTableToMarkdown,
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Marked, type Token, type Tokens, type TokensList } from "marked";
import { CardLinkNode } from "./CardLinkNode";
import { LiteralMarkdown } from "./LiteralMarkdown";

/** The editor only supports top-level tables, so only the document holds
 * them: an insert or paste anywhere else lands beside the block instead. */
const TopLevelDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | topLevelBlock)+",
  renderMarkdown: (node, h) =>
    node.content ? h.renderChildren(node.content, "\n\n") : "",
});

export function documentExtensions({
  cardLinkNode = CardLinkNode,
}: {
  cardLinkNode?: typeof CardLinkNode;
} = {}) {
  return [
    StarterKit.configure({
      document: false,
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: isSafeExternalUrl,
      },
    }),
    TopLevelDocument,
    LiteralMarkdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    cardLinkNode,
    Table.extend({
      group: "topLevelBlock",
      // The block join already puts a blank line around the table.
      renderMarkdown: (node, h) => renderTableToMarkdown(node, h).trim(),
    }).configure({ resizable: false }),
    TableRow,
    // A GFM table row can't hold a line break, so each cell holds one
    // paragraph of inline content.
    TableHeader.extend({ content: "paragraph" }),
    TableCell.extend({ content: "paragraph" }),
  ];
}

/** Cells in one row of a GFM table's source, split on unescaped pipes. */
const tableRowCellCount = (line: string) =>
  line
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u).length;

/**
 * A table the editor can show and write back unchanged: top level, no column
 * alignment, and the same number of cells in every row. Anything else stays
 * literal Markdown.
 */
function tableMeaning(table: Tokens.Table, nested: boolean): unknown[] {
  if (nested) {
    throw new Error("Nested table");
  }
  if (table.align.some((align) => align !== null)) {
    throw new Error("Aligned table");
  }
  const lines = table.raw.split("\n").filter((line) => line.trim());
  if (lines.some((line) => tableRowCellCount(line) !== table.header.length)) {
    throw new Error("Table that can't round-trip");
  }
  return [
    "table",
    table.header.map((cell) => markdownMeaning(cell.tokens, true)),
    table.rows.map((row) =>
      row.map((cell) => markdownMeaning(cell.tokens, true))
    ),
  ];
}

const lexer = new Marked({ gfm: true });
const extensions = documentExtensions();
const schema = getSchema(extensions);
export const markdownManager = new MarkdownManager({ extensions });

function markdownMeaning(
  tokens: Token[] | undefined,
  nested = false
): unknown[] {
  if (!tokens) {
    throw new Error("Missing Markdown tokens");
  }
  return tokens.flatMap((token): unknown[] => {
    switch (token.type) {
      case "space":
      case "checkbox":
        return [];
      case "paragraph":
        return [["paragraph", markdownMeaning(token.tokens, nested)]];
      case "text":
        return token.tokens
          ? markdownMeaning(token.tokens, nested)
          : [["text", decodeHtmlEntities(token.text)]];
      case "escape":
        return [["text", decodeHtmlEntities(token.text)]];
      case "heading":
        return [["heading", token.depth, markdownMeaning(token.tokens)]];
      case "strong":
      case "em":
      case "del":
        return [[token.type, markdownMeaning(token.tokens, nested)]];
      case "blockquote":
        return [[token.type, markdownMeaning(token.tokens, true)]];
      case "table":
        return [tableMeaning(token as Tokens.Table, nested)];
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
              markdownMeaning(item.tokens, true),
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

export {
  type NoteCapture,
  noteCaptureSavedMessage,
  prepareNoteCapture,
} from "./noteCapture";
