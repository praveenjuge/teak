import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { inferFileFormat } from "../shared/fileFormats";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const MEDIA_KINDS = ["image", "gif", "video"] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

const SPACING_MS: Record<MediaKind, number> = {
  image: 200,
  gif: 2000,
  video: 10_000,
};

const kindValidator = v.union(
  v.literal("image"),
  v.literal("gif"),
  v.literal("video")
);

const totalsValidator = v.object({
  examined: v.number(),
  image: v.number(),
  gif: v.number(),
  video: v.number(),
  skippedInProgress: v.number(),
  skippedTrashed: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  image: 0,
  gif: 0,
  video: 0,
  skippedInProgress: 0,
  skippedTrashed: 0,
  skippedDeletingAccounts: 0,
});

/**
 * Which colors job a card needs, if any. Every image is recolored (the new
 * palettes are sharper); GIFs and videos only when they have no colors yet.
 */
export const mediaColorsKind = (card: Doc<"cards">): MediaKind | null => {
  if (!card.fileKey) {
    return null;
  }
  if (card.type === "image") {
    return "image";
  }
  if (card.type !== "video" || (card.colors?.length ?? 0) > 0) {
    return null;
  }
  const fileName = card.fileMetadata?.fileName;
  const format = fileName
    ? (inferFileFormat({ fileName, mimeType: card.fileMetadata?.mimeType }) ??
      inferFileFormat({ fileName }))
    : null;
  return format?.id === "gif" ? "gif" : "video";
};

const scheduleColorsJob = async (
  ctx: MutationCtx,
  kind: MediaKind,
  card: Doc<"cards">,
  delayMs: number
) => {
  const renderables = (internal as any).workflows.steps.renderables;
  if (kind === "image") {
    await ctx.scheduler.runAfter(
      delayMs,
      renderables.analyzeImage.analyzeImage,
      { cardId: card._id }
    );
  } else if (kind === "gif") {
    await ctx.scheduler.runAfter(
      delayMs,
      renderables.extractAnimationPalette.extractAnimationPalette,
      { cardId: card._id }
    );
  } else {
    await ctx.scheduler.runAfter(
      delayMs,
      renderables.generateVideoThumbnail.generateVideoThumbnail,
      { cardId: card._id, rerender: true }
    );
  }
};

/**
 * Gives existing cards the colors new uploads now get: recolors every image
 * with the sharper palette, and reads colors for GIFs and videos that have
 * none (videos render again into their existing thumbnail and scrub files).
 * Trashed cards are skipped, and cards still in their first processing are
 * left to that run. A dry run (the
 * default) schedules nothing and reports what a real run would. Jobs are
 * spaced out by kind, and the next batch starts once this batch's last job
 * is due, so the queue stays short; the last batch logs the totals.
 *
 *   npx convex run migration/backfillMediaColors:backfillMediaColors
 *   npx convex run migration/backfillMediaColors:backfillMediaColors '{"dryRun":false}'
 *   npx convex run migration/backfillMediaColors:backfillMediaColors '{"dryRun":false,"kinds":["gif","video"]}'
 */
export const backfillMediaColors = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Only these kinds; all three by default. */
    kinds: v.optional(v.array(kindValidator)),
    /** Stop after this batch instead of scheduling the next. */
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
    const kinds = new Set<MediaKind>(args.kinds ?? MEDIA_KINDS);
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = emptyTotals();
    const deletingAccounts = new Map<string, boolean>();
    let delayMs = 0;
    for (const card of page.page) {
      batch.examined += 1;
      const kind = mediaColorsKind(card);
      if (!(kind && kinds.has(kind))) {
        continue;
      }
      // Trash purges delete cards and their files; a rerender racing that
      // would write files back with no card to own them.
      if (card.isDeleted) {
        batch.skippedTrashed += 1;
        continue;
      }
      const renderables = card.processingStatus?.renderables?.status;
      if (renderables === "pending" || renderables === "in_progress") {
        batch.skippedInProgress += 1;
        continue;
      }
      // Account deletion owns these rows while it runs.
      let deleting = deletingAccounts.get(card.userId);
      if (deleting === undefined) {
        deleting = Boolean(await getAccountDeletionState(ctx, card.userId));
        deletingAccounts.set(card.userId, deleting);
      }
      if (deleting) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch[kind] += 1;
      if (!dryRun) {
        await scheduleColorsJob(ctx, kind, card, delayMs);
        delayMs += SPACING_MS[kind];
      }
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
        delayMs,
        (internal as any)["migration/backfillMediaColors"].backfillMediaColors,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          kinds: [...kinds],
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillMediaColors finished", { dryRun, ...totals });
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
