import {
  type ArticleHastNode,
  transformArticleTree,
} from "@teak/convex/shared/highlights/articleTree";

// The server reads an article's text through the same tree changes and
// schema (`markdownToReaderText`), so highlights' offsets agree.
export { ARTICLE_SANITIZE_SCHEMA } from "@teak/convex/shared/highlights/articleTree";

/**
 * A rehype plugin, run before sanitizing: each valid `teak-image:<n>`
 * becomes the article's n-th signed image URL (the sanitizer would strip the
 * custom scheme), an opening heading that repeats the title goes, and
 * headings move down a level under the title.
 */
export const rehypeArticle =
  ({ imageUrls, title }: { imageUrls: readonly string[]; title?: string }) =>
  () =>
  (tree: ArticleHastNode) => {
    transformArticleTree(tree, { imageUrls, title });
  };
