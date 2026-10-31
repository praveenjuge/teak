import {
  buildCardObjectKey,
  type FilesCaptureScreenshotResult,
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
import { updateCardScreenshotHandler } from "../linkMetadata";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { queueObjectDeletion } from "../storage/r2";
import { getR2KeyPrefix } from "../storage/r2Keys";

// From #623 (12 Oct 2026) the renderer captured a link's fetched HTML offline,
// so pages whose CSS lives in separate files came out unstyled. #933 (31 Oct
// 2026) captures the saved copy instead. This takes each screenshot made in
// between again, from the card's saved copy. Delete it after its production
// run.
export const RESTYLE_WINDOW_START = Date.parse("2026-10-12T09:25:29Z");
// The new Core Worker went live at 09:32:40; runs already started then could
// still be on the old one for a few minutes.
export const RESTYLE_WINDOW_END = Date.parse("2026-10-31T10:00:00Z");

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
// Browser Run is shared with card processing; one capture every few seconds
// keeps the backfill to a browser or two at a time.
const CARD_SPACING_MS = 4000;

const totalsValidator = v.object({
  examined: v.number(),
  notLink: v.number(),
  trashed: v.number(),
  noScreenshot: v.number(),
  outsideWindow: v.number(),
  noFullCopy: v.number(),
  skippedDeletingAccounts: v.number(),
  skippedHasPreviewImage: v.number(),
  queued: v.number(),
  /** Of those queued, the cards whose grid image is the screenshot. */
  queuedShown: v.number(),
});
type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  notLink: 0,
  trashed: 0,
  noScreenshot: 0,
  outsideWindow: 0,
  noFullCopy: 0,
  skippedDeletingAccounts: 0,
  skippedHasPreviewImage: 0,
  queued: 0,
  queuedShown: 0,
});

type Verdict =
  | "notLink"
  | "trashed"
  | "noScreenshot"
  | "outsideWindow"
  | "noFullCopy"
  | "candidate";

const judge = (card: Doc<"cards">): Verdict => {
  if (card.type !== "link") {
    return "notLink";
  }
  if (card.isDeleted) {
    return "trashed";
  }
  const preview = card.metadata?.linkPreview;
  if (preview?.status !== "success" || !preview.screenshotStorageKey) {
    return "noScreenshot";
  }
  const takenAt = preview.screenshotUpdatedAt;
  if (
    takenAt === undefined ||
    takenAt < RESTYLE_WINDOW_START ||
    takenAt >= RESTYLE_WINDOW_END
  ) {
    return "outsideWindow";
  }
  return card.pageArchive?.kind === "full" ? "candidate" : "noFullCopy";
};

export const backfillLinkScreenshots = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    userId: v.optional(v.string()),
    /** Only cards whose grid shows the screenshot (no stored preview image). */
    onlyShown: v.optional(v.boolean()),
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
    const { onlyShown, userId } = args;
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
      const verdict = judge(card);
      if (verdict !== "candidate") {
        batch[verdict] += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      const shown = !card.metadata?.linkPreview?.imageStorageKey;
      if (onlyShown && !shown) {
        batch.skippedHasPreviewImage += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          batch.queued * CARD_SPACING_MS,
          internal.migration.backfillLinkScreenshots.retakeLinkScreenshot,
          { cardId: card._id }
        );
      }
      batch.queued += 1;
      if (shown) {
        batch.queuedShown += 1;
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
        dryRun ? 0 : batch.queued * CARD_SPACING_MS,
        internal.migration.backfillLinkScreenshots.backfillLinkScreenshots,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(onlyShown ? { onlyShown } : {}),
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillLinkScreenshots finished", {
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

export const getScreenshotCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      archiveKey: v.string(),
      screenshotKey: v.string(),
      userId: v.string(),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || judge(card) !== "candidate" || !card.pageArchive) {
      return null;
    }
    return {
      archiveKey: card.pageArchive.storageKey,
      screenshotKey: card.metadata?.linkPreview?.screenshotStorageKey ?? "",
      userId: card.userId,
    };
  },
});

/**
 * Swaps in the new screenshot only while the card still has the one the
 * backfill set out to replace; a card re-captured meanwhile keeps its own.
 */
export const swapLinkScreenshot = internalMutation({
  args: {
    cardId: v.id("cards"),
    replaces: v.string(),
    screenshotStorageKey: v.string(),
    screenshotHeight: v.number(),
    screenshotWidth: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, replaces, ...screenshot }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !card ||
      judge(card) !== "candidate" ||
      card.metadata?.linkPreview?.screenshotStorageKey !== replaces
    ) {
      await queueObjectDeletion(ctx, screenshot.screenshotStorageKey);
      return false;
    }
    await updateCardScreenshotHandler(ctx, {
      cardId,
      ...screenshot,
      screenshotUpdatedAt: Date.now(),
    });
    return true;
  },
});

export const retakeLinkScreenshot = internalAction({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.literal("retaken"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  handler: async (ctx, { cardId }) => {
    const candidate = await ctx.runQuery(
      internal.migration.backfillLinkScreenshots.getScreenshotCandidate,
      { cardId }
    );
    if (!candidate) {
      return "skipped";
    }
    // A fixed id, so a retried card writes over its own attempt.
    const destinationKey = buildCardObjectKey({
      cardId,
      envPrefix: getR2KeyPrefix(),
      objectId: "restyled",
      role: "screenshot",
      userId: candidate.userId,
    });
    await ctx.runMutation(internal.storage.ownership.registerObject, {
      key: destinationKey,
      userId: candidate.userId,
    });
    let outcome: Awaited<
      ReturnType<typeof callFilesWorkerJson<FilesCaptureScreenshotResult>>
    >;
    try {
      outcome = await callFilesWorkerJson<FilesCaptureScreenshotResult>({
        op: "capture-screenshot",
        params: { archiveKey: candidate.archiveKey, destinationKey },
      });
    } catch (error) {
      console.warn("[backfillLinkScreenshots] capture failed", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    if (outcome.kind !== "ok") {
      console.warn("[backfillLinkScreenshots] capture declined", {
        cardId,
        code: outcome.code,
      });
      return "failed";
    }
    const swapped = await ctx.runMutation(
      internal.migration.backfillLinkScreenshots.swapLinkScreenshot,
      {
        cardId,
        replaces: candidate.screenshotKey,
        screenshotHeight: outcome.data.height,
        screenshotStorageKey: destinationKey,
        screenshotWidth: outcome.data.width,
      }
    );
    return swapped ? "retaken" : "skipped";
  },
});
