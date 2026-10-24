/**
 * A link's article (`cards.article`): the text Teak's reader shows, taken
 * from the page's saved copy. The rules the Convex backend, the Files Worker
 * and the web app share.
 */

/** The R2 role of an article's Markdown. */
export const ARTICLE_TEXT_ROLE = "article-text";
/** The R2 role of an image an article shows. */
export const ARTICLE_IMAGE_ROLE = "article-image";

/** The most images one article keeps. */
export const ARTICLE_MAX_IMAGES = 20;
/** The widest an article image is stored. */
export const ARTICLE_IMAGE_MAX_WIDTH = 1600;
/** An article image heavier than this once encoded is left out. */
export const ARTICLE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** All of one article's encoded images together, so a step stays in memory. */
export const ARTICLE_IMAGES_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** Fewer words of body text than this is never an article. */
export const ARTICLE_MIN_WORDS = 120;
/**
 * A page Readability doesn't think is readable needs at least this many
 * words to count as an article.
 */
export const ARTICLE_UNREADERABLE_MIN_WORDS = 300;
/** "summarize article" runs only for articles at least this long. */
export const ARTICLE_SUMMARY_MIN_WORDS = 200;
/** How much of an article the summary reads. */
export const ARTICLE_SUMMARY_INPUT_CHARS = 6000;
/** How much of an article's opening a link's embedding reads. */
export const ARTICLE_EMBEDDING_OPENING_CHARS = 1500;

const WORDS_PER_MINUTE = 230;

/** Link categories whose card dialog opens on the Read tab. */
export const READ_FIRST_CATEGORIES: readonly string[] = [
  "article",
  "news",
  "research",
];

export const opensOnRead = (category: string | undefined): boolean =>
  category !== undefined && READ_FIRST_CATEGORIES.includes(category);

/** `teak-image:<n>`: the n-th (from 0) entry of `cards.article.imageKeys`. */
export const ARTICLE_IMAGE_SCHEME = "teak-image:";

export const articleImageToken = (index: number): string =>
  `${ARTICLE_IMAGE_SCHEME}${index}`;

/** The image index a `teak-image:<n>` reference names, or null. */
export const parseArticleImageToken = (value: string): number | null => {
  const match = /^teak-image:(0|[1-9]\d{0,2})$/u.exec(value.trim());
  return match ? Number(match[1]) : null;
};

const IMAGE_TOKEN_IN_MARKDOWN = /teak-image:(0|[1-9]\d{0,2})/gu;

/**
 * Rewrites each `teak-image:<n>` in an article's Markdown with `resolve(n)`;
 * a reference `resolve` has no answer for becomes an empty string.
 */
export const replaceArticleImageTokens = (
  markdown: string,
  resolve: (index: number) => string | undefined
): string =>
  markdown.replace(
    IMAGE_TOKEN_IN_MARKDOWN,
    (_match, index: string) => resolve(Number(index)) ?? ""
  );

interface WordSegmenter {
  segment: (text: string) => Iterable<{ isWordLike?: boolean }>;
}

type WordSegmenterConstructor = new (
  locale: undefined,
  options: { granularity: "word" }
) => WordSegmenter;

// Not in every TypeScript lib this file is compiled with; every runtime
// Teak targets has it.
const Segmenter = (
  globalThis.Intl as unknown as { Segmenter?: WordSegmenterConstructor }
).Segmenter;

const segmenter = Segmenter
  ? new Segmenter(undefined, { granularity: "word" })
  : null;

/**
 * Words in `text`: dictionary words for languages written without spaces
 * (Japanese, Chinese, Thai), whitespace-separated words elsewhere.
 */
export const countWords = (text: string): number => {
  if (!text.trim()) {
    return 0;
  }
  if (!segmenter) {
    return text.split(/\s+/u).filter(Boolean).length;
  }
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) {
      count += 1;
    }
  }
  return count;
};

/** Minutes to read `wordCount` words, never less than one. */
export const readingMinutes = (wordCount: number): number =>
  Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

/** Whether a page's text is long enough to be an article. */
export const isArticleLength = (
  wordCount: number,
  probablyReaderable: boolean
): boolean =>
  wordCount >= ARTICLE_MIN_WORDS &&
  (probablyReaderable || wordCount >= ARTICLE_UNREADERABLE_MIN_WORDS);

/** A low-cardinality bucket of an article's length, for analytics. */
export const articleWordsBucket = (wordCount: number): string => {
  if (wordCount < ARTICLE_MIN_WORDS) {
    return "<120";
  }
  if (wordCount < 500) {
    return "120-500";
  }
  if (wordCount < 2000) {
    return "500-2k";
  }
  if (wordCount < 5000) {
    return "2k-5k";
  }
  return ">5k";
};

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]*\)/gu;
const MARKDOWN_LINK = /\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/gu;
const FENCE = /^\s*(```|~~~).*$/gmu;
const HEADING = /^\s{0,3}#{1,6}\s+/gmu;
const QUOTE = /^\s{0,3}>\s?/gmu;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gmu;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gmu;
const TABLE_PIPE = /\s*\|\s*/gu;
const EMPHASIS = /(\*\*|__|~~|\*|_|`)(?=\S)([^\n]*?\S)\1/gu;
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|>~])/gu;
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/gmu;

/**
 * An article's Markdown as plain text, for search and embeddings: images
 * and link targets dropped, markup removed, blocks on lines of their own.
 */
export const articlePlainText = (markdown: string): string =>
  markdown
    .replace(FENCE, "")
    .replace(MARKDOWN_IMAGE, (_match, alt: string) => alt)
    .replace(MARKDOWN_LINK, (_match, text: string) => text)
    .replace(HORIZONTAL_RULE, "")
    .replace(TABLE_RULE, "")
    .replace(HEADING, "")
    .replace(QUOTE, "")
    .replace(LIST_MARKER, "")
    .replace(EMPHASIS, (_match, _marker: string, text: string) => text)
    .replace(ESCAPE, "$1")
    .split("\n")
    .map((line) =>
      line.includes("|")
        ? line
            .replace(/^\s*\|/u, "")
            .replace(/\|\s*$/u, "")
            .replace(TABLE_PIPE, " ")
        : line
    )
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

const DIGEST = /^[a-f0-9]{64}$/u;
const CARD_ID = /^[a-z0-9]+$/iu;

const contentKey = (
  userKeyPrefix: string,
  cardId: string,
  role: string,
  digest: string,
  extension: string
): string => {
  if (!(DIGEST.test(digest) && CARD_ID.test(cardId))) {
    throw new Error("article_invalid_key");
  }
  return `${userKeyPrefix}/${cardId}/${role}/${digest}.${extension}`;
};

/** `<user prefix>/<card>/article-text/<sha256>.md`, named by its content. */
export const articleTextObjectKey = (
  userKeyPrefix: string,
  cardId: string,
  digest: string
): string => contentKey(userKeyPrefix, cardId, ARTICLE_TEXT_ROLE, digest, "md");

/** `<user prefix>/<card>/article-image/<sha256>.webp`, named by its content. */
export const articleImageObjectKey = (
  userKeyPrefix: string,
  cardId: string,
  digest: string
): string =>
  contentKey(userKeyPrefix, cardId, ARTICLE_IMAGE_ROLE, digest, "webp");

/** Whether `key` is an article object of `cardId` under `userKeyPrefix`. */
export const isArticleObjectKey = (
  key: string,
  userKeyPrefix: string,
  cardId: string,
  role: typeof ARTICLE_TEXT_ROLE | typeof ARTICLE_IMAGE_ROLE
): boolean => {
  const root = `${userKeyPrefix}/${cardId}/${role}/`;
  if (!key.startsWith(root)) {
    return false;
  }
  const name = key.slice(root.length);
  const extension = role === ARTICLE_TEXT_ROLE ? ".md" : ".webp";
  return (
    name.endsWith(extension) && DIGEST.test(name.slice(0, -extension.length))
  );
};

export type ArticleSkip =
  | "already_extracted"
  | "no_archive"
  | "not_link"
  | "trashed";

export interface ArticleCandidate {
  article?: { extractedAt: number };
  isDeleted?: boolean;
  pageArchive?: { capturedAt: number };
  type: string;
}

/**
 * Why the "extract article" step leaves a card alone, or null to extract its
 * article from the saved copy. A card keeps an article made from the copy it
 * has, unless Refresh details asked for it again.
 *
 * Phase 8 hooks the freeze in here: a card with highlights keeps its article
 * on a refresh or a re-save, the same way `pageArchiveSkipReason` keeps its
 * copy.
 */
export const articleSkipReason = (
  card: ArticleCandidate,
  options: { refresh?: boolean } = {}
): ArticleSkip | null => {
  if (card.type !== "link") {
    return "not_link";
  }
  if (card.isDeleted) {
    return "trashed";
  }
  const archive = card.pageArchive;
  if (!archive) {
    return "no_archive";
  }
  const article = card.article;
  if (!article || options.refresh === true) {
    return null;
  }
  // An article made before the copy it should come from is stale.
  return article.extractedAt >= archive.capturedAt ? "already_extracted" : null;
};

/** Why "extract article" failed, as `processingStatus.article.error` says. */
export const ARTICLE_FAILURE_REASONS = [
  "archive_missing",
  "extract_error",
] as const;

export type ArticleFailureReason = (typeof ARTICLE_FAILURE_REASONS)[number];
