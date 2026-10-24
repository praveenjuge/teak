import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { readAdminSettings, readUserFlags } from "../adminAccess";
import { readDispatchQueueDepth } from "../card/processingRuns";
import { queueCardProcessing } from "../workflowDispatch";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
/** Waiting or running background runs past which a card waits its turn. */
const DEFAULT_MAX_QUEUE_DEPTH = 100;
const DEFAULT_THROTTLE_MS = 30_000;

const UNFINISHED = new Set(["pending", "in_progress"]);

const totalsValidator = v.object({
  examined: v.number(),
  toQueue: v.number(),
  trashed: v.number(),
  aiOff: v.number(),
  skippedDeletingAccounts: v.number(),
  /** Cards to reprocess, by card type. */
  byType: v.array(v.object({ type: v.string(), count: v.number() })),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  toQueue: 0,
  trashed: 0,
  aiOff: 0,
  skippedDeletingAccounts: 0,
  byType: [],
});

const countType = (byType: Totals["byType"], type: string, count = 1) => {
  const entry = byType.find((row) => row.type === type);
  if (entry) {
    entry.count += count;
  } else {
    byType.push({ type, count });
  }
};

const addTotals = (left: Totals, right: Totals): Totals => {
  const byType = left.byType.map((row) => ({ ...row }));
  for (const row of right.byType) {
    countType(byType, row.type, row.count);
  }
  return {
    examined: left.examined + right.examined,
    toQueue: left.toQueue + right.toQueue,
    trashed: left.trashed + right.trashed,
    aiOff: left.aiOff + right.aiOff,
    skippedDeletingAccounts:
      left.skippedDeletingAccounts + right.skippedDeletingAccounts,
    byType,
  };
};

/**
 * A card from before runs were numbered (no `processingRev`) can't have one
 * in flight, so a stage it still shows as unfinished never will finish, and
 * the card looks like it's processing forever. The saved copy doesn't count:
 * it never holds a card up.
 */
const hasStaleStage = (card: Doc<"cards">) =>
  card.processingRev === undefined &&
  Object.entries(card.processingStatus ?? {}).some(
    ([stage, status]) =>
      stage !== "archive" &&
      status !== undefined &&
      UNFINISHED.has(status.status)
  );

/**
 * Queues the run "Refresh details" queues for every card stuck that way: its
 * stages start over, a link's details and saved copy are fetched again, and
 * its summary and tags are written again. A card whose account has AI off,
 * or everyone's while AI is paused, is left alone, since the reset would
 * clear a summary that couldn't be written again.
 * Dry run by default, which only counts. Pages through every card in creation
 * order, and waits while the dispatcher is busy so new saves keep their usual
 * speed. The owner runs it in production.
 */
export const reprocessStaleCards = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    maxQueueDepth: v.optional(v.number()),
    throttleMs: v.optional(v.number()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    throttled: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totalsValidator,
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const maxQueueDepth = Math.max(
      1,
      Math.floor(args.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH)
    );
    const throttleMs = Math.max(0, args.throttleMs ?? DEFAULT_THROTTLE_MS);
    const previous = args.totals ?? emptyTotals();
    const next = { batchSize, dryRun, maxQueueDepth, throttleMs };

    if (
      !dryRun &&
      (await readDispatchQueueDepth(ctx, maxQueueDepth)) >= maxQueueDepth
    ) {
      const continuationScheduled = !args.once;
      if (continuationScheduled) {
        await ctx.scheduler.runAfter(
          throttleMs,
          internal.migration.reprocessStaleCards.reprocessStaleCards,
          { ...next, cursor: args.cursor ?? null, totals: previous }
        );
      }
      return {
        dryRun,
        isDone: false,
        throttled: true,
        continueCursor: args.cursor ?? null,
        continuationScheduled,
        batch: emptyTotals(),
        totals: previous,
      };
    }

    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const batch = emptyTotals();
    const accountDeleting = createAccountDeletionGate(ctx);
    const aiPaused = (await readAdminSettings(ctx)).aiPaused;
    const aiDisabled = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      if (!hasStaleStage(card)) {
        continue;
      }
      if (card.isDeleted) {
        batch.trashed += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (!aiDisabled.has(card.userId)) {
        const flags = await readUserFlags(ctx, card.userId);
        aiDisabled.set(card.userId, flags?.aiDisabled === true);
      }
      if (aiPaused || aiDisabled.get(card.userId)) {
        batch.aiOff += 1;
        continue;
      }
      batch.toQueue += 1;
      countType(batch.byType, card.type);
      if (!dryRun) {
        await queueCardProcessing(ctx, card._id, {
          refresh: true,
          reset: true,
        });
      }
    }

    const totals = addTotals(previous, batch);
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.migration.reprocessStaleCards.reprocessStaleCards,
        { ...next, cursor: page.continueCursor, totals }
      );
    } else if (isDone) {
      console.log("reprocessStaleCards finished", { dryRun, ...totals });
    }
    return {
      dryRun,
      isDone,
      throttled: false,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      batch,
      totals,
    };
  },
});
