import { parseArticleImageToken } from "@teak/convex/shared/article";
import { defaultSchema } from "rehype-sanitize";

/** The few hast shapes the reader's plugin touches. */
interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

const HEADING = /^h[1-6]$/u;

const textOf = (node: HastNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

const normalize = (text: string) =>
  text.replace(/\s+/gu, " ").trim().toLocaleLowerCase();

/** Element children in order, skipping whitespace text between blocks. */
const firstElement = (nodes: HastNode[]): HastNode | undefined =>
  nodes.find(
    (node) =>
      node.type === "element" ||
      (node.type === "text" && (node.value ?? "").trim() !== "")
  );

const resolveImages = (
  nodes: HastNode[],
  imageUrls: readonly string[]
): HastNode[] =>
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
 * A rehype plugin, run before sanitizing: each valid `teak-image:<n>`
 * becomes the article's n-th signed image URL (the sanitizer would strip the
 * custom scheme), an opening heading that repeats the title goes, and
 * headings move down a level under the title.
 */
export const rehypeArticle =
  ({ imageUrls, title }: { imageUrls: readonly string[]; title?: string }) =>
  () =>
  (tree: HastNode) => {
    const children = resolveImages(tree.children ?? [], imageUrls);
    const opening = firstElement(children);
    if (
      title &&
      opening?.tagName &&
      HEADING.test(opening.tagName) &&
      normalize(textOf(opening)) === normalize(title)
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
