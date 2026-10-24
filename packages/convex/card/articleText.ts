import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { markCardForEmbedding } from "../embedding/state";
import { r2KeyValidator } from "../schema";
import {
  ARTICLE_FAILURE_REASONS,
  ARTICLE_IMAGE_ROLE,
  ARTICLE_MAX_IMAGES,
  ARTICLE_TEXT_ROLE,
  articleWordsBucket,
  isArticleObjectKey,
  readingMinutes,
} from "../shared/article";
import { buildR2UserPrefix, queueObjectDeletion } from "../storage/r2";
import { queueBackendEvent } from "../telemetry/schedule";
import { searchPrefix } from "./documentTextFormat";
import {
  mergeProcessingStages,
  stageCompleted,
  stageFailed,
  stageInProgress,
} from "./processingStatus";
import { patchCardWithSearchSync } from "./searchSync";
import { getArticleTextRow } from "./textContents";

type ReadyArticle = Extract<
  NonNullable<Doc<"cards">["article"]>,
  { status: "ready" }
>;

const readyArticle = (card: Doc<"cards">): ReadyArticle | undefined =>
  card.article?.status === "ready" ? card.article : undefined;

/** The article objects a card holds, which a new article may replace. */
const articleKeys = (article: ReadyArticle | undefined): string[] =>
  article ? [article.textKey, ...article.imageKeys] : [];

/**
 * Queues the old article's objects that the new one doesn't use. Article
 * objects are named by their content, so an unchanged article has the same
 * keys, and deleting them would delete the new article.
 */
const queueReplacedKeys = async (
  ctx: MutationCtx,
  previous: string[],
  kept: string[]
) => {
  const keep = new Set(kept);
  for (const key of new Set(previous)) {
    if (!keep.has(key)) {
      await queueObjectDeletion(ctx, key);
    }
  }
};

/**
 * The card fields that say a link has no article text: cleared only when
 * they describe the article (a link never has a document's text).
 */
const clearedArticleText = (card: Doc<"cards">) =>
  card.documentTextKey === undefined ||
  card.documentTextKey === readyArticle(card)?.textKey
    ? {
        documentTextKey: undefined,
        hasExtractedText: undefined,
        extractedTextCharCount: undefined,
      }
    : {};

const deleteArticleRow = async (ctx: MutationCtx, cardId: Id<"cards">) => {
  const row = await getArticleTextRow(ctx, cardId);
  if (row) {
    await ctx.db.delete("cardTextContents", row._id);
  }
};

const assertOwnArticleKeys = (
  card: Doc<"cards">,
  textKey: string,
  imageKeys: string[]
) => {
  const prefix = buildR2UserPrefix(card.userId);
  if (
    !isArticleObjectKey(textKey, prefix, card._id, ARTICLE_TEXT_ROLE) ||
    imageKeys.length > ARTICLE_MAX_IMAGES ||
    imageKeys.some(
      (key) => !isArticleObjectKey(key, prefix, card._id, ARTICLE_IMAGE_ROLE)
    )
  ) {
    throw new ConvexError({
      code: "INVALID_STORAGE_KEY",
      message: "The article is outside the card's storage",
    });
  }
};

export const saveArticleTextHandler = async (
  ctx: MutationCtx,
  args: {
    article: {
      byline?: string;
      imageKeys: string[];
      lang?: string;
      title?: string;
      wordCount: number;
    };
    cardId: Id<"cards">;
    charCount: number;
    searchText: string;
    textKey: string;
    truncated: boolean;
  }
): Promise<boolean> => {
  const card = await ctx.db.get("cards", args.cardId);
  if (!card || (await getAccountDeletionState(ctx, card.userId))) {
    // Nothing will point at these objects; they are this run's alone.
    if (!card) {
      for (const key of [args.textKey, ...args.article.imageKeys]) {
        await queueObjectDeletion(ctx, key);
      }
    }
    return false;
  }
  assertOwnArticleKeys(card, args.textKey, args.article.imageKeys);
  const now = Date.now();
  const row = {
    cardId: card._id,
    userId: card.userId,
    kind: "article" as const,
    text: searchPrefix(args.searchText),
    sourceKey: args.textKey,
    charCount: args.charCount,
    truncated: args.truncated,
  };
  const existing = await getArticleTextRow(ctx, card._id);
  if (existing) {
    if (
      existing.sourceKey !== row.sourceKey ||
      existing.text !== row.text ||
      existing.charCount !== row.charCount ||
      existing.truncated !== row.truncated
    ) {
      await ctx.db.replace("cardTextContents", existing._id, row);
    }
  } else {
    await ctx.db.insert("cardTextContents", row);
  }
  const imageKeys = [...args.article.imageKeys];
  await queueReplacedKeys(
    ctx,
    [
      ...articleKeys(readyArticle(card)),
      ...(card.documentTextKey ? [card.documentTextKey] : []),
    ],
    [args.textKey, ...imageKeys]
  );
  const wordCount = Math.max(0, Math.round(args.article.wordCount));
  await patchCardWithSearchSync(ctx, card._id, {
    article: {
      status: "ready",
      textKey: args.textKey,
      imageKeys,
      wordCount,
      readingMinutes: readingMinutes(wordCount),
      ...(args.article.title ? { title: args.article.title } : {}),
      ...(args.article.byline ? { byline: args.article.byline } : {}),
      ...(args.article.lang ? { lang: args.article.lang } : {}),
      ...(args.truncated ? { truncated: true as const } : {}),
      extractedAt: now,
    },
    documentTextKey: args.textKey,
    hasExtractedText: true,
    extractedTextCharCount: args.charCount,
    processingStatus: mergeProcessingStages(card.processingStatus, {
      article: stageCompleted(now),
    }),
    updatedAt: now,
  });
  // The embedding reads the article's opening; the search text may not change.
  await markCardForEmbedding(ctx, card._id, card.userId);
  await queueBackendEvent(ctx, "article_extracted", card.userId, {
    outcome: "article",
    words_bucket: articleWordsBucket(wordCount),
  });
  return true;
};

/**
 * Records a link's article: the single write path for a ready
 * `cards.article`. It writes the `kind: "article"` text row search reads,
 * points `documentTextKey` at the Markdown so keyword search, embeddings and
 * the content API find it, and queues the old article's objects that the new
 * one doesn't use.
 */
export const saveArticleText = internalMutation({
  args: {
    cardId: v.id("cards"),
    textKey: r2KeyValidator,
    /** The article as plain text; the row keeps its first 32 KiB. */
    searchText: v.string(),
    charCount: v.number(),
    truncated: v.boolean(),
    article: v.object({
      imageKeys: v.array(r2KeyValidator),
      wordCount: v.number(),
      title: v.optional(v.string()),
      byline: v.optional(v.string()),
      lang: v.optional(v.string()),
    }),
  },
  returns: v.boolean(),
  handler: saveArticleTextHandler,
});

/** A page that isn't an article: its old article, if any, goes. */
export const recordNoArticle = internalMutation({
  args: { cardId: v.id("cards"), wordCount: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, { cardId, wordCount }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || (await getAccountDeletionState(ctx, card.userId))) {
      return false;
    }
    const previous = readyArticle(card);
    if (previous) {
      await deleteArticleRow(ctx, card._id);
      await queueReplacedKeys(ctx, articleKeys(previous), []);
    }
    const now = Date.now();
    await patchCardWithSearchSync(ctx, card._id, {
      ...(previous ? clearedArticleText(card) : {}),
      article: { status: "none", extractedAt: now },
      processingStatus: mergeProcessingStages(card.processingStatus, {
        article: stageCompleted(now),
      }),
      updatedAt: now,
    });
    if (previous) {
      await markCardForEmbedding(ctx, card._id, card.userId);
    }
    await queueBackendEvent(ctx, "article_extracted", card.userId, {
      outcome: "none",
      words_bucket: articleWordsBucket(wordCount ?? 0),
    });
    return true;
  },
});

/**
 * Marks the article stage in progress, failed, or done with nothing to read
 * (`completed`: a link without a saved copy). A failure never fails the card.
 */
export const markArticleStage = internalMutation({
  args: {
    cardId: v.id("cards"),
    reason: v.optional(
      v.union(...ARTICLE_FAILURE_REASONS.map((reason) => v.literal(reason)))
    ),
    status: v.union(
      v.literal("in_progress"),
      v.literal("failed"),
      v.literal("completed")
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, reason, status }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      return false;
    }
    const now = Date.now();
    const current = card.processingStatus?.article;
    let stage = stageCompleted(now);
    if (status === "in_progress") {
      stage = stageInProgress(now, current);
    } else if (status === "failed") {
      stage = stageFailed(now, reason ?? "extract_error", current);
    }
    await patchCardWithSearchSync(ctx, cardId, {
      processingStatus: mergeProcessingStages(card.processingStatus, {
        article: stage,
      }),
    });
    if (status === "failed") {
      await queueBackendEvent(ctx, "article_extracted", card.userId, {
        outcome: "failed",
        words_bucket: articleWordsBucket(0),
      });
    }
    return true;
  },
});

/**
 * "summarize article": the link's summary, written again from its article.
 * Only `aiSummary` changes; tags stay as they are.
 */
export const saveArticleSummary = internalMutation({
  args: { cardId: v.id("cards"), aiSummary: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { cardId, aiSummary }) => {
    const card = await ctx.db.get("cards", cardId);
    const summary = aiSummary.trim();
    if (
      !(card && summary && readyArticle(card)) ||
      (await getAccountDeletionState(ctx, card.userId))
    ) {
      return false;
    }
    if (card.aiSummary === summary) {
      return true;
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      aiSummary: summary,
      updatedAt: Date.now(),
    });
  },
});

/**
 * The card fields that drop a link's article, for an edit that points the
 * card at another page. `discardArticleObjects` removes what they pointed at.
 */
export const droppedArticleFields = (card: Doc<"cards">) =>
  card.article
    ? { article: undefined, ...clearedArticleText(card) }
    : ({} as Record<string, never>);

/** Deletes a dropped article's text row and queues its objects for deletion. */
export const discardArticleObjects = async (
  ctx: MutationCtx,
  card: Doc<"cards">
): Promise<void> => {
  const previous = readyArticle(card);
  if (!previous) {
    return;
  }
  await deleteArticleRow(ctx, card._id);
  await queueReplacedKeys(ctx, articleKeys(previous), []);
};
