import { internal } from "@teak/convex/_generated/api";
import { searchPrefix } from "@teak/convex/card/documentTextFormat";
import {
  ARTICLE_SUMMARY_INPUT_CHARS,
  ARTICLE_SUMMARY_MIN_WORDS,
  type ArticleFailureReason,
  type ArticleSkip,
  articleImageObjectKey,
  articleObjectDigest,
  articlePlainText,
  articleSkipReason,
  articleTextObjectKey,
} from "@teak/convex/shared/article";
import {
  type FilesExtractArticleResult,
  filesCardKeyPrefix,
} from "@teak/files-protocol";
import { runWithAiUsage } from "../../ai/aiUsage";
import { sha256Hex } from "../../lib";
import { gatedEnv } from "../filesOps";
import type { StepConfig } from "../runtime";
import type { WorkflowTelemetry } from "../telemetry";
import { generateLinkMetadata } from "./aiMetadata";
import {
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  loadCard,
} from "./context";
import { buildLinkContentParts } from "./metadata";

/**
 * Two retries, 20 seconds apart: what fails here is storage or a busy
 * isolate, not the page. A page that isn't an article is a result.
 */
export const EXTRACT_ARTICLE_STEP: StepConfig = {
  retries: { backoff: "constant", delay: "20 seconds", limit: 2 },
  timeout: "5 minutes",
};

/** The summary step: the AI provider's capacity is what fails it. */
export const SUMMARIZE_ARTICLE_STEP: StepConfig = {
  retries: { backoff: "exponential", delay: "30 seconds", limit: 3 },
  timeout: "10 minutes",
};

export type ArticleOutcome =
  | { reason: ArticleSkip | "card_missing"; status: "skipped" }
  | { reason: ArticleFailureReason; status: "failed" }
  | { status: "none"; wordCount: number }
  | { status: "extracted"; wordCount: number };

const markStage = (
  job: CardJob,
  status: "completed" | "failed" | "in_progress",
  reason?: ArticleFailureReason
) =>
  job.deps.convex.mutation(
    internal.card.articleText.markArticleStage,
    { cardId: job.cardId, status, ...(reason ? { reason } : {}) },
    guardOf(job)
  );

/** The stage failed for good: the step ran out of retries. */
export const markArticleFailed = async (job: CardJob): Promise<null> => {
  const loaded = await loadCard(job);
  const status = loaded?.card.processingStatus?.article?.status;
  if (status === "pending" || status === "in_progress") {
    await markStage(job, "failed", "extract_error");
  }
  return null;
};

const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/**
 * The "extract article" step: the article in the link's saved copy, as
 * Markdown and WebP images under keys named by their content, so extracting
 * the same copy again writes and keeps the same objects. Each object is
 * registered to the account before it is written; `saveArticleText` then
 * records them and queues the old article's objects it no longer uses.
 */
export const extractArticle = async (job: CardJob): Promise<ArticleOutcome> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { reason: "card_missing", status: "skipped" };
  }
  const { card } = loaded;
  const skip = articleSkipReason(card, { refresh: job.refresh });
  if (skip) {
    // A link without a copy has no article to wait for.
    const stage = card.processingStatus?.article?.status;
    if (
      skip !== "already_extracted" &&
      (stage === "pending" || stage === "in_progress")
    ) {
      await markStage(job, "completed");
    }
    return { reason: skip, status: "skipped" };
  }
  const archive = card.pageArchive as NonNullable<typeof card.pageArchive>;
  await markStage(job, "in_progress");
  const outcome = await job.deps.filesOp<FilesExtractArticleResult>({
    op: "extract-article",
    params: { archiveKey: archive.storageKey, pageUrl: archive.sourceUrl },
  });
  if (outcome.kind === "fallback") {
    throw new Error(`extract_article_unavailable:${outcome.code}`);
  }
  const result = outcome.data;
  if (result.kind === "missing") {
    await markStage(job, "failed", "archive_missing");
    return { reason: "archive_missing", status: "failed" };
  }
  if (result.kind === "none") {
    await job.deps.convex.mutation(
      internal.card.articleText.recordNoArticle,
      { cardId: job.cardId, wordCount: result.wordCount },
      guardOf(job)
    );
    return { status: "none", wordCount: result.wordCount };
  }

  const prefix = filesCardKeyPrefix(loaded.keyPrefix, card.userId);
  // Content the current article already stored keeps its key and isn't
  // written again. New content gets a key named for this run, so it never
  // reuses one an earlier run queued for deletion.
  const current = card.article?.status === "ready" ? card.article : null;
  const storedKey = (keys: string[], digest: string) =>
    keys.find((key) => articleObjectDigest(key) === digest);
  const textDigest = await sha256Hex(result.markdown);
  const textKey =
    storedKey(current ? [current.textKey] : [], textDigest) ??
    articleTextObjectKey(prefix, card._id, job.rev, textDigest);
  const images = await Promise.all(
    result.images.map(async (image) => {
      const body = fromBase64(image.base64);
      const digest = await sha256Hex(body.buffer as ArrayBuffer);
      return {
        body,
        key:
          storedKey(current?.imageKeys ?? [], digest) ??
          articleImageObjectKey(prefix, card._id, job.rev, digest),
      };
    })
  );
  const stored = new Set(
    current ? [current.textKey, ...current.imageKeys] : []
  );
  const bucket = gatedEnv(job.env).BUCKET;
  for (const image of images) {
    if (!stored.has(image.key)) {
      await ensureObjectOwnership(job, card.userId, image.key);
      await bucket.put(image.key, image.body, {
        httpMetadata: { contentType: "image/webp" },
      });
    }
  }
  if (!stored.has(textKey)) {
    await ensureObjectOwnership(job, card.userId, textKey);
    await bucket.put(textKey, result.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
  }
  const plainText = articlePlainText(result.markdown);
  await job.deps.convex.mutation(
    internal.card.articleText.saveArticleText,
    {
      article: {
        imageKeys: images.map((image) => image.key),
        wordCount: result.wordCount,
        ...(result.title ? { title: result.title } : {}),
        ...(result.byline ? { byline: result.byline } : {}),
        ...(result.lang ? { lang: result.lang } : {}),
      },
      cardId: job.cardId,
      charCount: Array.from(plainText).length,
      searchText: searchPrefix(plainText),
      textKey,
      truncated: result.truncated,
    },
    guardOf(job)
  );
  return { status: "extracted", wordCount: result.wordCount };
};

export type SummaryOutcome =
  | { status: "skipped"; reason: string }
  | { status: "summarized" };

/**
 * "summarize article": the link's summary written again from its article's
 * first 6,000 characters, for articles of 200 words or more. Tags stay; an
 * account with AI turned off or paused keeps the summary it has.
 */
export const summarizeArticle = async (
  job: CardJob,
  telemetry: WorkflowTelemetry
): Promise<SummaryOutcome> => {
  const loaded = await loadCard(job);
  const article = loaded?.card.article;
  if (!(loaded && article?.status === "ready")) {
    return { reason: "no_article", status: "skipped" };
  }
  if (article.wordCount < ARTICLE_SUMMARY_MIN_WORDS) {
    return { reason: "short", status: "skipped" };
  }
  const { card } = loaded;
  return await runWithAiUsage(
    {
      cardId: job.cardId,
      convexSiteUrl: job.convexSiteUrl,
      userId: card.userId,
    },
    async (): Promise<SummaryOutcome> => {
      const gate = await job.deps.aiGate(card.userId);
      if (gate !== "allowed") {
        return { reason: `ai_${gate}`, status: "skipped" };
      }
      const object = await gatedEnv(job.env).BUCKET.get(article.textKey);
      if (!object) {
        return { reason: "article_missing", status: "skipped" };
      }
      const opening = articlePlainText(
        await new Response(object.body).text()
      ).slice(0, ARTICLE_SUMMARY_INPUT_CHARS);
      const content = buildLinkContentParts(card, undefined, {
        kind: "article",
        text: opening,
      }).join("\n");
      const generated = await generateLinkMetadata(
        job,
        telemetry,
        content,
        card.url || card.content
      );
      if (!generated.aiSummary.trim()) {
        return { reason: "empty", status: "skipped" };
      }
      await job.deps.convex.mutation(
        internal.card.articleText.saveArticleSummary,
        { aiSummary: generated.aiSummary, cardId: job.cardId },
        guardOf(job)
      );
      return { status: "summarized" };
    }
  );
};
