export const ARTICLE_TEXT_ROLE = "article-text";
export const ARTICLE_IMAGE_ROLE = "article-image";

export const ARTICLE_MAX_IMAGES = 20;
export const ARTICLE_IMAGE_MAX_WIDTH = 1600;
export const ARTICLE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ARTICLE_IMAGES_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export const ARTICLE_MIN_WORDS = 120;
/**
 * A page Readability doesn't think is readable needs at least this many
 * words to count as an article.
 */
export const ARTICLE_UNREADERABLE_MIN_WORDS = 300;
export const ARTICLE_SUMMARY_MIN_WORDS = 200;
export const ARTICLE_SUMMARY_INPUT_CHARS = 6000;
export const ARTICLE_EMBEDDING_OPENING_CHARS = 1500;

const WORDS_PER_MINUTE = 230;

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

export const parseArticleImageToken = (value: string): number | null => {
  const match = /^teak-image:(0|[1-9]\d{0,2})$/u.exec(value.trim());
  return match ? Number(match[1]) : null;
};

const IMAGE_TOKEN_IN_MARKDOWN = /teak-image:(0|[1-9]\d{0,2})/gu;

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

export const readingMinutes = (wordCount: number): number =>
  Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

export const isArticleLength = (
  wordCount: number,
  probablyReaderable: boolean
): boolean =>
  wordCount >= ARTICLE_MIN_WORDS &&
  (probablyReaderable || wordCount >= ARTICLE_UNREADERABLE_MIN_WORDS);

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
// The line patterns match spaces and tabs, never `\s`: a pattern that can
// cross line breaks backtracks over every blank line after it, and a long
// run of them (a code block of empty lines) takes minutes.
const FENCE = /^[ \t]*(```|~~~).*$/gmu;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gmu;
const QUOTE = /^[ \t]{0,3}>[ \t]?/gmu;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gmu;
const TABLE_RULE =
  /^[ \t]*(?:\|[ \t]*)?:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*(?:\|[ \t]*)?$/gmu;
const TABLE_PIPE = /[ \t]*\|[ \t]*/gu;
const EMPHASIS = /(\*\*|__|~~|\*|_|`)(?=\S)([^\n]*?\S)\1/gu;
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|>~])/gu;
const HORIZONTAL_RULE = /^[ \t]*(?:[-*_][ \t]*){3,}$/gmu;

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
const OBJECT_NAME = /^r[1-9]\d*-[a-f0-9]{64}$/u;

const contentKey = (
  userKeyPrefix: string,
  cardId: string,
  role: string,
  rev: number,
  digest: string,
  extension: string
): string => {
  if (
    !(
      DIGEST.test(digest) &&
      CARD_ID.test(cardId) &&
      Number.isSafeInteger(rev) &&
      rev > 0
    )
  ) {
    throw new Error("article_invalid_key");
  }
  return `${userKeyPrefix}/${cardId}/${role}/r${rev}-${digest}.${extension}`;
};

/**
 * `<user prefix>/<card>/article-text/r<rev>-<sha256>.md`. The run's number
 * keeps a name from coming back once it is queued for deletion: the Files
 * Worker refuses every write to a deleted key.
 */
export const articleTextObjectKey = (
  userKeyPrefix: string,
  cardId: string,
  rev: number,
  digest: string
): string =>
  contentKey(userKeyPrefix, cardId, ARTICLE_TEXT_ROLE, rev, digest, "md");

export const articleImageObjectKey = (
  userKeyPrefix: string,
  cardId: string,
  rev: number,
  digest: string
): string =>
  contentKey(userKeyPrefix, cardId, ARTICLE_IMAGE_ROLE, rev, digest, "webp");

export const articleObjectDigest = (key: string): string | null =>
  /\/article-(?:text|image)\/r[1-9]\d*-([a-f0-9]{64})\.(?:md|webp)$/u.exec(
    key
  )?.[1] ?? null;

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
    name.endsWith(extension) &&
    OBJECT_NAME.test(name.slice(0, -extension.length))
  );
};

export type ArticleSkip =
  | "already_extracted"
  | "frozen"
  | "no_archive"
  | "not_link"
  | "trashed";

export interface ArticleCandidate {
  article?: { extractedAt: number; status?: string };
  hasHighlights?: boolean;
  isDeleted?: boolean;
  pageArchive?: { capturedAt: number };
  type: string;
}

/**
 * Why the "extract article" step leaves a card alone, or null to extract its
 * article from the saved copy. A card keeps an article made from the copy it
 * has, unless Refresh details asked for it again. A card with highlights
 * keeps the article they were made in whatever asks (`frozen`), the same way
 * `pageArchiveSkipReason` keeps its copy; an imported highlight's card still
 * gets its first article.
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
  if (card.hasHighlights && article?.status === "ready") {
    return "frozen";
  }
  if (!article || options.refresh === true) {
    return null;
  }
  return article.extractedAt >= archive.capturedAt ? "already_extracted" : null;
};

export const ARTICLE_FAILURE_REASONS = [
  "archive_missing",
  "extract_error",
] as const;

export type ArticleFailureReason = (typeof ARTICLE_FAILURE_REASONS)[number];
