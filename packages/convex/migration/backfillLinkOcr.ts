import {
  type FilesImageTextResult,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import {
  ocrBackfillArgs,
  ocrBackfillReturns,
  runOcrBackfillPage,
} from "./ocrBackfill";

/** Two image reads per card, this far apart: about 40 Gemma calls a minute. */
const CARD_SPACING_MS = 3000;

/**
 * The stored images whose text a link card is read for, as card processing
 * reads them (apps/files-worker/src/workflows/cardProcessing/linkText.ts):
 * its preview image (og:image), then its screenshot.
 */
export const linkOcrSourceKeys = (card: Pick<Doc<"cards">, "metadata">) => {
  const preview = card.metadata?.linkPreview;
  if (preview?.status !== "success") {
    return [];
  }
  return [preview.imageStorageKey, preview.screenshotStorageKey].filter(
    (key): key is string => Boolean(key)
  );
};

/**
 * Reads the text in the preview images and screenshots of links saved
 * before Teak read them, one card every 3 s. It writes only `aiOcrText`
 * and `ocrCheckedAt`, and skips cards in Trash and accounts being deleted
 * or with AI turned off; each card checks the AI gate again before its
 * calls. A card is done once `ocrCheckedAt` is set, so a stopped run picks
 * up where it left off.
 *
 * A dry run (the default) writes nothing and reports what a real run would
 * schedule. `userId` limits it to one account, as a canary; `once` runs one
 * batch.
 *
 *   npx convex run migration/backfillLinkOcr:backfillLinkOcr
 *   npx convex run migration/backfillLinkOcr:backfillLinkOcr '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillLinkOcr:backfillLinkOcr '{"dryRun":false}'
 */
export const backfillLinkOcr = internalMutation({
  args: ocrBackfillArgs,
  returns: ocrBackfillReturns,
  handler: (ctx, args) =>
    runOcrBackfillPage(ctx, args, {
      cardAction: internal.migration.backfillLinkOcr.backfillLinkOcrCard,
      hasSource: (card) => linkOcrSourceKeys(card).length > 0,
      isKind: (card) => card.type === "link",
      name: "backfillLinkOcr",
      nextPage: internal.migration.backfillLinkOcr.backfillLinkOcr,
      spacingMs: CARD_SPACING_MS,
    }),
});

export const getLinkOcrCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      processingRev: v.optional(v.number()),
      sourceKeys: v.array(v.string()),
      userId: v.string(),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      card?.type !== "link" ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined
    ) {
      return null;
    }
    const sourceKeys = linkOcrSourceKeys(card);
    return sourceKeys.length > 0
      ? { processingRev: card.processingRev, sourceKeys, userId: card.userId }
      : null;
  },
});

/**
 * Stores a link's image text unless card processing ran since it was read
 * (it reads the new images itself) or the card was read or trashed since.
 */
export const storeLinkOcr = internalMutation({
  args: {
    cardId: v.id("cards"),
    processingRev: v.optional(v.number()),
    aiOcrText: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, processingRev, aiOcrText }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !card ||
      card.isDeleted ||
      card.ocrCheckedAt !== undefined ||
      card.processingRev !== processingRev
    ) {
      return false;
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      aiOcrText: aiOcrText || undefined,
      ocrCheckedAt: Date.now(),
    });
  },
});

/**
 * Reads one link's images with the `extract-image-text` op card processing
 * uses, and stores only their text. An image the op declines (gone, or a
 * format it can't decode) reads as none; any other failure, an older Worker
 * without the op included, is logged and leaves the card unread.
 */
export const backfillLinkOcrCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("empty"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate = await ctx.runQuery(
      internal.migration.backfillLinkOcr.getLinkOcrCandidate,
      { cardId }
    );
    if (!candidate) {
      return "skipped";
    }
    // AI paused from the console, or turned off by the user: no model call,
    // and the card stays unread for a later run.
    const aiGate = await ctx.runQuery(internal.adminAccess.getAiGate, {
      userId: candidate.userId,
    });
    if (aiGate !== "allowed") {
      return "skipped";
    }
    const texts: string[] = [];
    try {
      for (const sourceKey of candidate.sourceKeys) {
        const outcome = await callFilesWorkerJson<FilesImageTextResult>({
          op: "extract-image-text",
          params: { sourceKey },
        });
        if (outcome.kind === "ok" && outcome.data.text) {
          texts.push(outcome.data.text);
        }
      }
    } catch (error) {
      console.warn("[backfillLinkOcr] reading failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    const aiOcrText = normalizeImageOcrText(texts.join("\n\n"));
    const stored = await ctx.runMutation(
      internal.migration.backfillLinkOcr.storeLinkOcr,
      {
        cardId,
        processingRev: candidate.processingRev,
        ...(aiOcrText ? { aiOcrText } : {}),
      }
    );
    if (!stored) {
      return "skipped";
    }
    return aiOcrText ? "stored" : "empty";
  },
});
