/**
 * An article's Markdown as the text Teak's reader shows: the same GFM
 * parse, tree changes and sanitizing as the web reader, then its text with
 * whitespace collapsed. Highlights' offsets point into this text.
 */

import { sanitize } from "hast-util-sanitize";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { normalizeReaderText } from "./anchor";
import {
  ARTICLE_SANITIZE_SCHEMA,
  type ArticleHastNode,
  articleTreeText,
  transformArticleTree,
} from "./articleTree";

/** Stand-ins for the article's signed image URLs: only their count matters. */
const placeholderImageUrls = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `https://image.invalid/${index}`);

export const markdownToReaderText = (
  markdown: string,
  { imageCount = 0, title }: { imageCount?: number; title?: string } = {}
): string => {
  const mdast = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const tree = toHast(mdast) as unknown as ArticleHastNode;
  transformArticleTree(tree, {
    imageUrls: placeholderImageUrls(imageCount),
    title,
  });
  const clean = sanitize(
    tree as unknown as Parameters<typeof sanitize>[0],
    ARTICLE_SANITIZE_SCHEMA
  ) as unknown as ArticleHastNode;
  return normalizeReaderText(articleTreeText(clean));
};
