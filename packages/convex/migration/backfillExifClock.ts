import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import type { imageExifValidator } from "../schema";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

// Reads the EXIF of photos processed before the Files Worker stored the
// camera's clock time, so "Taken" stops moving with the viewer's zone.
// Delete this file and its tests once the production run finishes.

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
const CARD_SPACING_MS = 500;

const totalsValidator = v.object({
  examined: v.number(),
  alreadyStored: v.number(),
  noSource: v.number(),
  queued: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  alreadyStored: 0,
  noSource: 0,
  queued: 0,
  skippedDeletingAccounts: 0,
});

/** An image card with an EXIF capture time read before `takenAtClock`. */
const takenAtOf = (card: Doc<"cards">): number | undefined =>
  card.type === "image" ? card.fileMetadata?.exif?.takenAt : undefined;

export const backfillExifClock = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
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
    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = emptyTotals();
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const card of page.page) {
      batch.examined += 1;
      if (takenAtOf(card) === undefined) {
        continue;
      }
      if (card.fileMetadata?.exif?.takenAtClock !== undefined) {
        batch.alreadyStored += 1;
        continue;
      }
      if (!card.fileKey) {
        batch.noSource += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          batch.queued * CARD_SPACING_MS,
          internal.migration.backfillExifClock.backfillExifClockCard,
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
      await ctx.scheduler.runAfter(
        dryRun ? 0 : batch.queued * CARD_SPACING_MS,
        internal.migration.backfillExifClock.backfillExifClock,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("backfillExifClock finished", { dryRun, ...totals });
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

export const getExifClockCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({ sourceKey: v.string(), takenAt: v.number() })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    const takenAt = card ? takenAtOf(card) : undefined;
    if (
      !card?.fileKey ||
      takenAt === undefined ||
      card.fileMetadata?.exif?.takenAtClock !== undefined
    ) {
      return null;
    }
    return { sourceKey: card.fileKey, takenAt };
  },
});

export const storeExifClock = internalMutation({
  args: {
    cardId: v.id("cards"),
    takenAt: v.number(),
    takenAtClock: v.number(),
    takenAtOffset: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, takenAt, takenAtClock, takenAtOffset }) => {
    const card = await ctx.db.get("cards", cardId);
    const exif = card?.fileMetadata?.exif;
    // The card was reprocessed or its file changed while the Worker read it.
    if (
      !(card?.fileMetadata && exif) ||
      takenAtOf(card) !== takenAt ||
      exif.takenAtClock !== undefined
    ) {
      return false;
    }
    return await patchCardWithSearchSync(ctx, cardId, {
      fileMetadata: {
        ...card.fileMetadata,
        exif: {
          ...exif,
          takenAtClock,
          ...(takenAtOffset === undefined ? {} : { takenAtOffset }),
        },
      },
      // No updatedAt: nobody edited the card, and "Edited" would say so.
    });
  },
});

export const backfillExifClockCard = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("skipped"),
    v.literal("unreadable"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate: { sourceKey: string; takenAt: number } | null =
      await ctx.runQuery(
        internal.migration.backfillExifClock.getExifClockCandidate,
        { cardId }
      );
    if (!candidate) {
      return "skipped";
    }
    let exif: Infer<typeof imageExifValidator> | undefined;
    try {
      const outcome = await callFilesWorkerJson<{
        exif?: Infer<typeof imageExifValidator>;
      }>({
        op: "analyze-image",
        params: { sourceKey: candidate.sourceKey },
      });
      if (outcome.kind !== "ok") {
        console.warn("[backfillExifClock] Worker declined to read EXIF", {
          cardId,
          code: outcome.code,
        });
        return "failed";
      }
      exif = outcome.data.exif;
    } catch (error) {
      console.warn("[backfillExifClock] reading EXIF failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    // Same capture time as stored, or this isn't the EXIF the card was read from.
    if (
      exif?.takenAtClock === undefined ||
      exif.takenAt !== candidate.takenAt
    ) {
      return "unreadable";
    }
    const stored: boolean = await ctx.runMutation(
      internal.migration.backfillExifClock.storeExifClock,
      {
        cardId,
        takenAt: candidate.takenAt,
        takenAtClock: exif.takenAtClock,
        ...(exif.takenAtOffset === undefined
          ? {}
          : { takenAtOffset: exif.takenAtOffset }),
      }
    );
    return stored ? "stored" : "skipped";
  },
});
