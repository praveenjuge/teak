/**
 * The article tree Teak's reader renders, and the text it shows. The web
 * reader runs `transformArticleTree` and `ARTICLE_SANITIZE_SCHEMA` as rehype
 * plugins; the server runs them on the same Markdown to get the text the
 * reader shows (`markdownToReaderText`), so highlights made on either side
 * point at the same characters.
 */

import { defaultSchema } from "hast-util-sanitize";
import { parseArticleImageToken } from "../article";

/** The few hast shapes the reader touches. */
export interface ArticleHastNode {
  children?: ArticleHastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

const HEADING = /^h[1-6]$/u;

const textOf = (node: ArticleHastNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

const normalizeTitle = (text: string) =>
  text.replace(/\s+/gu, " ").trim().toLocaleLowerCase();

/** Element children in order, skipping whitespace text between blocks. */
const firstElement = (nodes: ArticleHastNode[]): ArticleHastNode | undefined =>
  nodes.find(
    (node) =>
      node.type === "element" ||
      (node.type === "text" && (node.value ?? "").trim() !== "")
  );

const resolveImages = (
  nodes: ArticleHastNode[],
  imageUrls: readonly string[]
): ArticleHastNode[] =>
  nodes.flatMap((node) => {
    if (node.type !== "element") {
      return [node];
    }
    if (node.tagName === "img") {
      // Only the article's own images: a reference to an image it doesn't
      // have, or any other address, renders nothing.
      const src = String(node.properties?.src ?? "");
      const index = parseArticleImageToken(src);
      const url = index === null ? undefined : imageUrls[index];
      return url
        ? [{ ...node, properties: { ...node.properties, src: url } }]
        : [];
    }
    return [
      {
        ...node,
        // The reader's title is the page's only h1.
        tagName: node.tagName === "h1" ? "h2" : node.tagName,
        children: resolveImages(node.children ?? [], imageUrls),
      },
    ];
  });

/**
 * Before sanitizing: each valid `teak-image:<n>` becomes the article's n-th
 * image URL (the sanitizer would strip the custom scheme), an opening
 * heading that repeats the title goes, and headings move down a level under
 * the title.
 */
export const transformArticleTree = (
  tree: ArticleHastNode,
  { imageUrls, title }: { imageUrls: readonly string[]; title?: string }
): void => {
  const children = resolveImages(tree.children ?? [], imageUrls);
  const opening = firstElement(children);
  if (
    title &&
    opening?.tagName &&
    HEADING.test(opening.tagName) &&
    normalizeTitle(textOf(opening)) === normalizeTitle(title)
  ) {
    children.splice(children.indexOf(opening), 1);
  }
  tree.children = children;
};

/**
 * rehype-sanitize's GitHub schema: no raw HTML, no scripts or frames, and
 * links and images only over http(s) and mailto.
 */
export const ARTICLE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

// React drops whitespace text inside these, so the page never has it.
const TABLE_ELEMENTS = new Set(["table", "tbody", "thead", "tfoot", "tr"]);

/**
 * The text the reader shows for a sanitized tree, as the page's
 * `textContent` reads it: an image shows its caption (its title).
 */
export const articleTreeText = (node: ArticleHastNode): string => {
  if (node.type === "text") {
    return node.value ?? "";
  }
  if (node.type === "element" && node.tagName === "img") {
    const caption = node.properties?.title;
    return typeof caption === "string" ? caption : "";
  }
  if (node.type !== "element" && node.type !== "root") {
    return "";
  }
  const inTable = node.tagName ? TABLE_ELEMENTS.has(node.tagName) : false;
  let text = "";
  for (const child of node.children ?? []) {
    if (inTable && child.type === "text" && !(child.value ?? "").trim()) {
      continue;
    }
    text += articleTreeText(child);
  }
  return text;
};
