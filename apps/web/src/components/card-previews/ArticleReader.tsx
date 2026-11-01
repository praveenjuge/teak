"use client";

import { captureEvent } from "@teak/convex/shared/analytics";
import { articleWordsBucket } from "@teak/convex/shared/article";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, {
  type Components,
  type ExtraProps,
  type Options as MarkdownOptions,
} from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { CardModalCard } from "@/components/card-modal";
import { getDisplayHostname } from "@/components/cards/cardDisplay";
import { ResilientMediaImage } from "@/components/cards/previews/ResilientMediaImage";
import { SiteFavicon } from "@/components/cards/SiteFavicon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CardHighlightsControl } from "@/hooks/useCardHighlights";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import { handleCardLinkClick } from "@/lib/openCardLink";
import { cn } from "@/lib/utils";
import {
  ArticleHighlights,
  type HighlightJump,
  type ReaderHighlightControls,
} from "./ArticleHighlights";
import { ARTICLE_SANITIZE_SCHEMA, rehypeArticle } from "./articleMarkdown";
import {
  cachedFileTextPreview,
  requestFileTextPreview,
} from "./fileTextPreviewCache";

/**
 * The attribute on the reader's root `<article>`. Phase 8's highlight layer
 * finds the reader by it, then the article body (`ARTICLE_BODY_ATTRIBUTE`),
 * whose text is the Markdown as the reader renders it: the header, title and
 * footer sit outside the body, so offsets into its text never count them.
 */
export const ARTICLE_READER_ATTRIBUTE = "data-article-reader";
export const ARTICLE_BODY_ATTRIBUTE = "data-article-body";

const ARTICLE_MAX_BYTES = 2.5 * 1024 * 1024;

export type ArticleReaderState =
  | { kind: "ready" }
  | { kind: "preparing" }
  | { kind: "failed" }
  | { kind: "none" };

export const articleReaderState = (
  card: Pick<CardModalCard, "article" | "processingStatus" | "type">
): ArticleReaderState => {
  if (card.type !== "link") {
    return { kind: "none" };
  }
  if (card.article?.status === "ready") {
    return { kind: "ready" };
  }
  const stage = card.processingStatus?.article?.status;
  if (stage === "pending" || stage === "in_progress") {
    return { kind: "preparing" };
  }
  return stage === "failed" ? { kind: "failed" } : { kind: "none" };
};

const READING_COLUMN = "mx-auto w-full max-w-[68ch]";

function ArticleSkeleton({ note }: { note?: string }) {
  const t = useTranslations("cardPreviews.reader");
  return (
    <div
      aria-label={note ?? t("loading")}
      className={cn(READING_COLUMN, "flex flex-col gap-3")}
      role="status"
    >
      <Skeleton aria-hidden="true" className="h-4 w-48" />
      <Skeleton aria-hidden="true" className="mt-3 h-8 w-11/12" />
      <Skeleton aria-hidden="true" className="h-8 w-3/5" />
      <div className="mt-6 flex flex-col gap-3">
        {[
          "w-full",
          "w-11/12",
          "w-full",
          "w-10/12",
          "w-full",
          "w-9/12",
          "w-full",
          "w-2/3",
        ].map((width, index) => (
          <Skeleton
            aria-hidden="true"
            className={cn("h-4", width)}
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of placeholder lines
            key={index}
          />
        ))}
      </div>
      {note ? (
        <p className="mt-4 text-muted-foreground text-sm">{note}</p>
      ) : null}
    </div>
  );
}

function ArticleMessage({
  action,
  message,
}: {
  action?: ReactNode;
  message: string;
}) {
  return (
    <div
      className={cn(READING_COLUMN, "flex flex-col items-start gap-2 py-8")}
      role="status"
    >
      <p className="text-muted-foreground text-sm">{message}</p>
      {action}
    </div>
  );
}

const useArticleMarkdown = (
  textKey: string | undefined,
  url: string | undefined
) => {
  const cached = textKey ? cachedFileTextPreview(textKey) : undefined;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    markdown: string | null;
  } | null>(null);
  const retry = () => {
    setLoaded(null);
    setAttempt((count) => count + 1);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` loads the article again after a failure
  useEffect(() => {
    if (!(textKey && url) || cachedFileTextPreview(textKey) !== undefined) {
      return;
    }
    let active = true;
    requestFileTextPreview({
      cacheKey: textKey,
      fileUrl: url,
      maxBytes: ARTICLE_MAX_BYTES,
    })
      .catch(() => null)
      .then((markdown) => {
        if (active) {
          setLoaded({ key: textKey, markdown });
        }
      });
    return () => {
      active = false;
    };
  }, [textKey, url, attempt]);

  if (!textKey) {
    return { retry, status: "missing" as const };
  }
  if (cached !== undefined) {
    return { markdown: cached, retry, status: "ready" as const };
  }
  if (loaded?.key !== textKey) {
    return { retry, status: "loading" as const };
  }
  return loaded.markdown === null
    ? { retry, status: "error" as const }
    : { markdown: loaded.markdown, retry, status: "ready" as const };
};

interface ArticleReaderProps {
  card: CardModalCard;
  highlightControlsRef?: RefObject<ReaderHighlightControls | null>;
  highlightJump?: HighlightJump | null;
  highlights?: CardHighlightsControl;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}

const NO_IMAGES: readonly string[] = [];

interface ReaderImages {
  cardId: string;
  imageKeys: readonly string[];
  imageUrls: readonly string[];
}

const ReaderImagesContext = createContext<ReaderImages>({
  cardId: "",
  imageKeys: NO_IMAGES,
  imageUrls: NO_IMAGES,
});

function ReaderImage({
  alt,
  src,
  title: caption,
}: ComponentProps<"img"> & ExtraProps) {
  const { cardId, imageKeys, imageUrls } = useContext(ReaderImagesContext);
  const url = typeof src === "string" ? src : "";
  if (!url) {
    return null;
  }
  const index = imageUrls.indexOf(url);
  return (
    <span className="reader-figure">
      <ResilientMediaImage
        alt={alt ?? ""}
        cardId={cardId}
        className="h-auto w-full rounded-lg"
        loading="lazy"
        src={url}
        storageKey={index >= 0 ? imageKeys[index] : undefined}
      />
      {caption ? <span className="reader-caption">{caption}</span> : null}
    </span>
  );
}

/**
 * The reader's Markdown elements. They live outside the component so they
 * keep one identity: a component made during render is a new type each
 * time, and React would remount its links, images and tables on every
 * highlight change, leaving the highlight layer's text index pointing at
 * nodes no longer in the page.
 */
const READER_COMPONENTS: Components = {
  a: ({ children, href }) => (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  ),
  img: ReaderImage,
  table: ({ children }) => (
    <div className="reader-table">
      <table>{children}</table>
    </div>
  ),
};

const REMARK_PLUGINS: NonNullable<MarkdownOptions["remarkPlugins"]> = [
  remarkGfm,
];

/**
 * The Read tab: a link's article in one typographic default. It renders
 * the extracted Markdown, never the page's HTML: GFM, then the article's own
 * images, then rehype-sanitize's schema.
 */
export function ArticleReader({
  card,
  highlights,
  highlightControlsRef,
  highlightJump,
  onRetry,
  retrying,
  title: fallbackTitle,
}: ArticleReaderProps) {
  const t = useTranslations("cardPreviews.reader");
  const tc = useTranslations("common");
  const locale = useIntlLocale(US_ENGLISH_LOCALE);
  const state = articleReaderState(card);
  const article = card.article?.status === "ready" ? card.article : undefined;
  const loaded = useArticleMarkdown(article?.textKey, card.articleUrl);
  const imageUrls = card.articleImageUrls ?? NO_IMAGES;
  const title = article?.title ?? fallbackTitle;
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const category = card.metadata?.linkCategory?.category ?? "none";
  const wordCount = article?.wordCount;
  const opened = loaded.status === "ready";
  useEffect(() => {
    if (opened && wordCount !== undefined) {
      captureEvent("reader_opened", {
        category,
        surface: "modal",
        words_bucket: articleWordsBucket(wordCount),
      });
    }
  }, [opened, wordCount, category]);

  const plugins = useMemo<NonNullable<MarkdownOptions["rehypePlugins"]>>(
    () => [
      rehypeArticle({ imageUrls, title }),
      [rehypeSanitize, ARTICLE_SANITIZE_SCHEMA],
    ],
    [imageUrls, title]
  );
  const imageKeys = article?.imageKeys ?? NO_IMAGES;
  const images = useMemo<ReaderImages>(
    () => ({ cardId: card._id, imageKeys, imageUrls }),
    [card._id, imageKeys, imageUrls]
  );

  if (state.kind === "preparing") {
    return <ArticleSkeleton note={t("preparing")} />;
  }
  if (state.kind === "none") {
    return null;
  }
  if (state.kind === "failed") {
    return (
      <ArticleMessage
        action={
          onRetry ? (
            <Button
              className="h-auto px-0"
              disabled={retrying}
              onClick={onRetry}
              size="sm"
              variant="link"
            >
              {tc("tryAgain")}
            </Button>
          ) : null
        }
        message={t("failed")}
      />
    );
  }
  if (loaded.status === "loading") {
    return <ArticleSkeleton />;
  }
  if (loaded.status !== "ready" || !article) {
    return (
      <ArticleMessage
        action={
          <Button
            className="h-auto px-0"
            onClick={loaded.retry}
            size="sm"
            variant="link"
          >
            {tc("tryAgain")}
          </Button>
        }
        message={t("loadFailed")}
      />
    );
  }

  const host = getDisplayHostname(card.url);
  const savedAt =
    card.pageArchive?.capturedAt ?? card.savedAt ?? card.createdAt;
  const date = new Date(savedAt).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const facts = [
    host,
    article.byline,
    t("minutes", { minutes: Math.max(1, article.readingMinutes) }),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    // The title and the body each take their own text's direction: the
    // header's site name is Latin, so one `dir="auto"` on the whole article
    // would read an Arabic article left to right.
    <article
      className={cn(READING_COLUMN, "relative")}
      lang={article.lang}
      ref={rootRef}
      {...{ [ARTICLE_READER_ATTRIBUTE]: card._id }}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-sm">
        {facts.map((fact, index) => (
          <span className="inline-flex min-w-0 items-center gap-1.5" key={fact}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            {fact === host ? <SiteFavicon hostname={host} /> : null}
            <span className="truncate">{fact}</span>
          </span>
        ))}
      </header>
      {title ? (
        <h1
          className="mt-4 text-balance font-semibold text-2xl leading-tight tracking-tight md:text-3xl"
          dir="auto"
        >
          {title}
        </h1>
      ) : null}
      <div
        className="typeset typeset-reader mt-6"
        dir="auto"
        ref={bodyRef}
        {...{ [ARTICLE_BODY_ATTRIBUTE]: "" }}
      >
        <ReaderImagesContext.Provider value={images}>
          <Markdown
            components={READER_COMPONENTS}
            rehypePlugins={plugins}
            remarkPlugins={REMARK_PLUGINS}
            skipHtml
          >
            {loaded.markdown}
          </Markdown>
        </ReaderImagesContext.Provider>
      </div>
      {highlights ? (
        <ArticleHighlights
          articleKey={article.textKey}
          bodyRef={bodyRef}
          control={highlights}
          controlsRef={highlightControlsRef}
          jump={highlightJump}
          rootRef={rootRef}
          version={`${article.textKey}:${imageUrls.length}:${title ?? ""}`}
        />
      ) : null}
      <footer className="mt-12 flex flex-col gap-1 border-border/70 border-t pt-4 text-muted-foreground text-sm">
        {article.truncated ? <p>{t("shortened")}</p> : null}
        <p>
          {t.rich("savedFrom", {
            date,
            host: host ?? "",
            link: (chunks) => (
              <a
                className="font-medium text-foreground underline decoration-1 underline-offset-4"
                href={sanitizeExternalUrl(card.url)}
                onClick={(event) => handleCardLinkClick(event, card)}
                rel="noopener noreferrer"
                target="_blank"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </footer>
    </article>
  );
}
