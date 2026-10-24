import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { readDispatchQueueDepth } from "../card/processingRuns";
import { mergeProcessingStages, stagePending } from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchSync";
import { pageArchiveSkipReason } from "../shared/pageArchive";
import { queueCardProcessing } from "../workflowDispatch";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
/** Waiting or running background runs past which a page waits its turn. */
const DEFAULT_MAX_QUEUE_DEPTH = 100;
const DEFAULT_THROTTLE_MS = 30_000;
/** Accounts named one by one in the counts; the rest are summed. */
const MAX_COUNTED_USERS = 1000;

const UNFINISHED = new Set(["pending", "in_progress"]);

const totalsValidator = v.object({
  examined: v.number(),
  links: v.number(),
  toQueue: v.number(),
  alreadyArchived: v.number(),
  failedBefore: v.number(),
  queuedBefore: v.number(),
  processing: v.number(),
  trashed: v.number(),
  skippedDeletingAccounts: v.number(),
  /** Links to archive per account, up to 1,000 accounts. */
  perUser: v.record(v.string(), v.number()),
  otherUsers: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  links: 0,
  toQueue: 0,
  alreadyArchived: 0,
  failedBefore: 0,
  queuedBefore: 0,
  processing: 0,
  trashed: 0,
  skippedDeletingAccounts: 0,
  perUser: {},
  otherUsers: 0,
});

const addTotals = (left: Totals, right: Totals): Totals => {
  const perUser = { ...left.perUser };
  let otherUsers = left.otherUsers + right.otherUsers;
  for (const [userId, count] of Object.entries(right.perUser)) {
    if (
      perUser[userId] !== undefined ||
      Object.keys(perUser).length < MAX_COUNTED_USERS
    ) {
      perUser[userId] = (perUser[userId] ?? 0) + count;
    } else {
      otherUsers += count;
    }
  }
  return {
    examined: left.examined + right.examined,
    links: left.links + right.links,
    toQueue: left.toQueue + right.toQueue,
    alreadyArchived: left.alreadyArchived + right.alreadyArchived,
    failedBefore: left.failedBefore + right.failedBefore,
    queuedBefore: left.queuedBefore + right.queuedBefore,
    processing: left.processing + right.processing,
    trashed: left.trashed + right.trashed,
    skippedDeletingAccounts:
      left.skippedDeletingAccounts + right.skippedDeletingAccounts,
    perUser,
    otherUsers,
  };
};

/**
 * Queues an archive-only run for every link without a saved copy: not in
 * Trash, never failed before, and not already waiting for one.
 * Dry run by default, which only counts (per account and in total). Pages
 * through every card in creation order, and waits while the dispatcher is
 * busy so new saves keep their usual speed. The owner runs it in production.
 */
export const backfillPageArchives = internalMutation({
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
    const next = {
      batchSize,
      dryRun,
      maxQueueDepth,
      throttleMs,
    };

    if (
      !dryRun &&
      (await readDispatchQueueDepth(ctx, maxQueueDepth)) >= maxQueueDepth
    ) {
      const continuationScheduled = !args.once;
      if (continuationScheduled) {
        await ctx.scheduler.runAfter(
          throttleMs,
          internal.migration.backfillPageArchives.backfillPageArchives,
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
    for (const card of page.page) {
      batch.examined += 1;
      if (card.type !== "link") {
        continue;
      }
      batch.links += 1;
      const skip = pageArchiveSkipReason(card);
      if (skip === "trashed") {
        batch.trashed += 1;
        continue;
      }
      if (skip !== null) {
        batch.alreadyArchived += skip === "already_archived" ? 1 : 0;
        continue;
      }
      const stages = card.processingStatus ?? {};
      const archiveStatus = stages.archive?.status;
      if (archiveStatus === "failed") {
        batch.failedBefore += 1;
        continue;
      }
      if (archiveStatus && UNFINISHED.has(archiveStatus)) {
        batch.queuedBefore += 1;
        continue;
      }
      // Queuing a run replaces the one in flight, so a card still being
      // processed is left to finish; the next pass picks it up.
      if (
        Object.values(stages).some(
          (stage) => stage && UNFINISHED.has(stage.status)
        )
      ) {
        batch.processing += 1;
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.toQueue += 1;
      batch.perUser[card.userId] = (batch.perUser[card.userId] ?? 0) + 1;
      if (!dryRun) {
        await patchCardWithSearchSync(ctx, card._id, {
          processingStatus: mergeProcessingStages(card.processingStatus, {
            archive: stagePending(),
          }),
        });
        await queueCardProcessing(ctx, card._id, { archiveOnly: true });
      }
    }

    const totals = addTotals(previous, batch);
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.migration.backfillPageArchives.backfillPageArchives,
        { ...next, cursor: page.continueCursor, totals }
      );
    } else if (isDone) {
      const { perUser, ...counts } = totals;
      console.log("backfillPageArchives finished", {
        dryRun,
        ...counts,
        accounts: Object.keys(perUser).length,
      });
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
