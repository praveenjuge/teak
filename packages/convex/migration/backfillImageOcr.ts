import {
  type FilesImageMetadataResult,
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
import { createAccountDeletionGate } from "../accountDeletion";
import { readUserFlags } from "../adminAccess";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { resolveImageAnalysisKey } from "../shared/imageAnalysis";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
/** One image op this far apart: about 30 Gemma calls a minute. */
const CARD_SPACING_MS = 2000;

const totalsValidator = v.object({
  examined: v.number(),
  /** Images and videos whose text was already read. */
  alreadyRead: v.number(),
  /** Images and videos with nothing to read: tiny, or no thumbnail yet. */
  noSource: v.number(),
  /** Cards in Trash, left for Refresh details if they come back. */
  trashed: v.number(),
  /** Cards scheduled (a dry run counts what it would schedule). */
  queued: v.number(),
  skippedDeletingAccounts: v.number(),
  /** Cards of accounts with AI turned off, never sent to the model. */
  skippedAiDisabled: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  alreadyRead: 0,
  noSource: 0,
  trashed: 0,
  queued: 0,
  skippedDeletingAccounts: 0,
  skippedAiDisabled: 0,
});

/**
 * The stored image the vision model reads for a card's text, as card
 * processing picks it (apps/files-worker/src/workflows/cardProcessing/
 * metadata.ts): an image's analysis key, a video's thumbnail.
 */
export const imageOcrSourceKey = (
  card: Pick<Doc<"cards">, "fileKey" | "fileMetadata" | "thumbnailKey" | "type">
): string | undefined => {
  if (card.type === "image") {
    return resolveImageAnalysisKey(card);
  }
  return card.type === "video" ? card.thumbnailKey : undefined;
};

/**
 * Reads the text inside images and video thumbnails saved before Teak read
 * it, one vision call per card, 2 s apart. It writes only `aiOcrText` and
 * `ocrCheckedAt`, never the summary or tags, and skips cards in Trash and
 * accounts being deleted or with AI turned off, and each card checks the AI
 * gate again before its call, so a pause stops the work. A card is done once
 * `ocrCheckedAt` is set, so a
 * stopped run picks up where it left off.
 *
 * A dry run (the default) writes nothing and reports what a real run would
 * schedule. Each batch schedules the next once its last card is due, and the
 * last one logs the totals. `userId` limits it to one account, as a canary;
 * `once` runs one batch.
 *
 *   npx convex run migration/backfillImageOcr:backfillImageOcr
 *   npx convex run migration/backfillImageOcr:backfillImageOcr '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillImageOcr:backfillImageOcr '{"dryRun":false}'
 */
export const backfillImageOcr = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
    once: v.optional(v.boolean()),
    userId: v.optional(v.string()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totalsValidator,
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    if (!(dryRun || isFilesWorkerConfigured())) {
      throw new Error("files_worker_not_configured");
    }
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const { userId } = args;
    const cards = userId
      ? ctx.db
          .query("cards")
          .withIndex("by_created", (q) => q.eq("userId", userId))
      : ctx.db.query("cards");
    const page = await cards.paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    const batch = emptyTotals();
    const accountDeleting = createAccountDeletionGate(ctx);
    const aiDisabled = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      if (card.type !== "image" && card.type !== "video") {
        continue;
      }
      if (card.ocrCheckedAt !== undefined) {
        batch.alreadyRead += 1;
        continue;
      }
      if (card.isDeleted) {
        batch.trashed += 1;
        continue;
      }
      if (!imageOcrSourceKey(card)) {
        batch.noSource += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      let disabled = aiDisabled.get(card.userId);
      if (disabled === undefined) {
        disabled = Boolean((await readUserFlags(ctx, card.userId))?.aiDisabled);
        aiDisabled.set(card.userId, disabled);
      }
      if (disabled) {
        batch.skippedAiDisabled += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          batch.queued * CARD_SPACING_MS,
          internal.migration.backfillImageOcr.backfillImageOcrCard,
          { cardId: card._id }
        );
      }
      batch.queued += 1;
    }

    const previous = args.totals ?? emptyTotals();
    const totals = Object.fromEntries(
      Object.entries(batch).map(([key, value]) => [
        key,
        previous[key as keyof Totals] + value,
      ])
    ) as Totals;
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      // The next batch starts as this one's last card is due.
      await ctx.scheduler.runAfter(
        dryRun ? 0 : batch.queued * CARD_SPACING_MS,
        internal.migration.backfillImageOcr.backfillImageOcr,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillImageOcr finished", {
        dryRun,
        ...(userId ? { userId } : {}),
        ...totals,
      });
    }
    return {
      dryRun,
      isDone,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      batch,
      totals,
    };
  },
});

export const getImageOcrCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      processingRev: v.optional(v.number()),
      sourceKey: v.string(),
      title: v.optional(v.string()),
      userId: v.string(),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    const sourceKey = card && imageOcrSourceKey(card);
    if (!(card && sourceKey) || card.isDeleted || card.ocrCheckedAt) {
      return null;
    }
    const title =
      card.type === "video"
        ? card.fileMetadata?.fileName || card.content || undefined
        : undefined;
    return {
      processingRev: card.processingRev,
      sourceKey,
      userId: card.userId,
      ...(title ? { title } : {}),
    };
  },
});

/**
 * Stores a card's image text unless card processing ran since it was read
 * (Refresh details then reads it itself) or the text is already stored.
 */
export const storeImageOcr = internalMutation({
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
 * Reads one card's image text with the same `generate-image-metadata` op
 * card processing uses, and stores only the text. A failure is logged and
 * leaves the card unread, so a rerun tries it again.
 */
export const backfillImageOcrCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("empty"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate = await ctx.runQuery(
      internal.migration.backfillImageOcr.getImageOcrCandidate,
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
    let aiOcrText: string | undefined;
    try {
      const outcome = await callFilesWorkerJson<FilesImageMetadataResult>({
        op: "generate-image-metadata",
        params: {
          sourceKey: candidate.sourceKey,
          ...(candidate.title ? { title: candidate.title } : {}),
        },
      });
      if (outcome.kind !== "ok") {
        console.warn("[backfillImageOcr] image unavailable", {
          cardId,
          code: outcome.code,
        });
        return "failed";
      }
      const { text } = outcome.data;
      if (typeof text !== "string") {
        // A Worker from before image text reads none; leave the card unread.
        console.warn("[backfillImageOcr] the Files Worker sent no text", {
          cardId,
        });
        return "failed";
      }
      aiOcrText = normalizeImageOcrText(text);
    } catch (error) {
      console.warn("[backfillImageOcr] reading failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    const stored = await ctx.runMutation(
      internal.migration.backfillImageOcr.storeImageOcr,
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
