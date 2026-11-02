import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import {
  callFilesWorkerJson,
  type FilesWorkerHeadObjectResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

// Records each link screenshot's stored size, which says how much the page
// shows (`shared/screenshotDetail.ts`). New screenshots get it when they're
// captured; this measures the ones taken before that. Dry run by default:
// run it once with `dryRun: false` after reading the dry run's counts.

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
// One small HEAD request per card; spaced so a page doesn't burst the Worker.
const CARD_SPACING_MS = 100;

const totalsValidator = v.object({
  examined: v.number(),
  noScreenshot: v.number(),
  alreadyMeasured: v.number(),
  queued: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  noScreenshot: 0,
  alreadyMeasured: 0,
  queued: 0,
  skippedDeletingAccounts: 0,
});

export const backfillScreenshotBytes = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    // One account's cards, to try it on before the whole deployment.
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
    for (const card of page.page) {
      batch.examined += 1;
      const preview = card.metadata?.linkPreview;
      if (card.type !== "link" || !preview?.screenshotStorageKey) {
        batch.noScreenshot += 1;
        continue;
      }
      if (typeof preview.screenshotBytes === "number") {
        batch.alreadyMeasured += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          batch.queued * CARD_SPACING_MS,
          internal.migration.backfillScreenshotBytes.measureScreenshotBytes,
          { cardId: card._id }
        );
      }
      batch.queued += 1;
    }

    const previous = args.totals ?? emptyTotals();
    const totals: Totals = {
      examined: previous.examined + batch.examined,
      noScreenshot: previous.noScreenshot + batch.noScreenshot,
      alreadyMeasured: previous.alreadyMeasured + batch.alreadyMeasured,
      queued: previous.queued + batch.queued,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        dryRun ? 0 : batch.queued * CARD_SPACING_MS,
        internal.migration.backfillScreenshotBytes.backfillScreenshotBytes,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillScreenshotBytes finished", {
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

export const getScreenshotToMeasure = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    const preview = card?.metadata?.linkPreview;
    if (
      card?.type !== "link" ||
      !preview?.screenshotStorageKey ||
      typeof preview.screenshotBytes === "number"
    ) {
      return null;
    }
    return preview.screenshotStorageKey;
  },
});

export const storeScreenshotBytes = internalMutation({
  args: {
    cardId: v.id("cards"),
    screenshotStorageKey: v.string(),
    screenshotBytes: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, screenshotStorageKey, screenshotBytes }) => {
    const card = await ctx.db.get("cards", cardId);
    const preview = card?.metadata?.linkPreview;
    // Only the file that was measured: a screenshot taken meanwhile records
    // its own size when it's saved.
    if (
      !(card && preview) ||
      preview.screenshotStorageKey !== screenshotStorageKey ||
      typeof preview.screenshotBytes === "number"
    ) {
      return false;
    }
    // Not search-visible and not an edit, so no search sync or updatedAt.
    await ctx.db.patch("cards", cardId, {
      metadata: {
        ...card.metadata,
        linkPreview: { ...preview, screenshotBytes },
      },
    });
    return true;
  },
});

export const measureScreenshotBytes = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("stored"),
    v.literal("missing"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const key: string | null = await ctx.runQuery(
      internal.migration.backfillScreenshotBytes.getScreenshotToMeasure,
      { cardId }
    );
    if (!key) {
      return "skipped";
    }
    let size: number | undefined;
    try {
      const outcome = await callFilesWorkerJson<FilesWorkerHeadObjectResult>({
        op: "head-object",
        params: { key },
      });
      if (outcome.kind !== "ok" || !outcome.data.exists) {
        return "missing";
      }
      size = outcome.data.size;
    } catch (error) {
      console.warn("[backfillScreenshotBytes] measuring failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    if (typeof size !== "number") {
      return "missing";
    }
    const stored: boolean = await ctx.runMutation(
      internal.migration.backfillScreenshotBytes.storeScreenshotBytes,
      { cardId, screenshotStorageKey: key, screenshotBytes: size }
    );
    return stored ? "stored" : "skipped";
  },
});
