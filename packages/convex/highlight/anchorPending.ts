/**
 * Imported highlights arrive as quotes alone. Once the card's article is
 * saved (`saveArticleText`), this finds each in the article's text as the
 * reader shows it and records where it is. Quotes it can't find stay
 * waiting, and the reader's panel lists them as not found.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { readDocumentText } from "../card/documentText";
import { anchorQuote } from "../shared/highlights/anchor";
import { markdownToReaderText } from "../shared/highlights/readerText";
import { applyAnchors, loadCardHighlights } from "./highlights";

/** What the reader shows as the title, which an opening heading repeats. */
export const readerTitleOf = (card: Doc<"cards">): string | undefined =>
  (card.article?.status === "ready" ? card.article.title : undefined) ??
  card.metadataTitle ??
  card.metadata?.linkPreview?.title;

/** The article a card's highlights point into, or null. */
export const articleSourceOf = (card: Doc<"cards">) =>
  card.article?.status === "ready"
    ? {
        imageCount: card.article.imageKeys.length,
        textKey: card.article.textKey,
        title: readerTitleOf(card),
      }
    : null;

/** The reader's text of an article, read from storage. */
export const readArticleReaderText = async (source: {
  imageCount: number;
  textKey: string;
  title?: string;
}): Promise<string> =>
  markdownToReaderText(await readDocumentText(source.textKey), {
    imageCount: source.imageCount,
    title: source.title,
  });

const pendingSource = async (
  ctx: Pick<QueryCtx, "db">,
  cardId: Id<"cards">
) => {
  const card = await ctx.db.get("cards", cardId);
  const source = card ? articleSourceOf(card) : null;
  if (!(card?.hasHighlights && source) || card.isDeleted) {
    return null;
  }
  const pending = (await loadCardHighlights(ctx, cardId))
    .filter((row) => row.unanchored === true)
    .map((row) => ({ highlightId: row._id, quote: row.quote }));
  return pending.length > 0 ? { ...source, pending } : null;
};

type PendingAnchors = NonNullable<Awaited<ReturnType<typeof pendingSource>>>;

export const getPendingAnchors = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      imageCount: v.number(),
      textKey: v.string(),
      title: v.optional(v.string()),
      pending: v.array(
        v.object({ highlightId: v.id("highlights"), quote: v.string() })
      ),
    })
  ),
  handler: (ctx, { cardId }) => pendingSource(ctx, cardId),
});

const anchorValidator = v.object({
  highlightId: v.id("highlights"),
  quote: v.string(),
  prefix: v.optional(v.string()),
  suffix: v.optional(v.string()),
  start: v.number(),
  end: v.number(),
});

export const saveAnchors = internalMutation({
  args: {
    cardId: v.id("cards"),
    textKey: v.string(),
    anchors: v.array(anchorValidator),
  },
  returns: v.number(),
  handler: (ctx, args) => applyAnchors(ctx, args),
});

/** Finds where each waiting highlight is in the card's article. */
export const anchorPendingHighlights = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.number(),
  handler: async (ctx, { cardId }): Promise<number> => {
    const source: PendingAnchors | null = await ctx.runQuery(
      internal.highlight.anchorPending.getPendingAnchors,
      { cardId }
    );
    if (!source) {
      return 0;
    }
    const text = await readArticleReaderText(source);
    const anchors = source.pending.flatMap(({ highlightId, quote }) => {
      const anchor = anchorQuote(text, { quote });
      return anchor
        ? [
            {
              highlightId,
              ...anchor,
              // The text as found, so the quote matches its offsets.
              quote: text.slice(anchor.start, anchor.end),
            },
          ]
        : [];
    });
    if (anchors.length === 0) {
      return 0;
    }
    return await ctx.runMutation(internal.highlight.anchorPending.saveAnchors, {
      anchors,
      cardId,
      textKey: source.textKey,
    });
  },
});
