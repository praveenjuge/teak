import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { enqueueObjectDeletion } from "../workflowDispatch";

// Export jobs and tracked storage objects whose owner no longer has an
// account: accounts deleted before deletion removed exports, and a few whose
// tracked objects outlived the deletion. Each row's R2 keys are queued for
// deletion, then the row goes. An owner with a live `users` row, a deletion
// in progress or any cards is left alone.

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const ITEM_PAGE = 100;

const totalsValidator = v.object({
  examined: v.number(),
  skippedLiveOwner: v.number(),
  skippedDeleting: v.number(),
  skippedHasCards: v.number(),
  skippedIncomplete: v.number(),
  exportJobsDeleted: v.number(),
  exportJobItemsDeleted: v.number(),
  storageObjectsDeleted: v.number(),
  objectKeysQueued: v.number(),
});
type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  skippedLiveOwner: 0,
  skippedDeleting: 0,
  skippedHasCards: 0,
  skippedIncomplete: 0,
  exportJobsDeleted: 0,
  exportJobItemsDeleted: 0,
  storageObjectsDeleted: 0,
  objectKeysQueued: 0,
});

type OwnerState = "gone" | "live" | "deleting" | "hasCards";

const ownerState = async (
  ctx: MutationCtx,
  userId: string
): Promise<OwnerState> => {
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .take(5);
  if (owners.some((owner) => owner.deletedAt === undefined)) {
    return "live";
  }
  const deletion = await ctx.db
    .query("accountDeletionStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (deletion) {
    return "deleting";
  }
  const card = await ctx.db
    .query("cards")
    .withIndex("by_created", (q) => q.eq("userId", userId))
    .first();
  return card ? "hasCards" : "gone";
};

const ownerGate = (ctx: MutationCtx, batch: Totals) => {
  const seen = new Map<string, Promise<OwnerState>>();
  return async (userId: string) => {
    let state = seen.get(userId);
    if (!state) {
      state = ownerState(ctx, userId);
      seen.set(userId, state);
    }
    const resolved = await state;
    if (resolved === "live") {
      batch.skippedLiveOwner += 1;
    } else if (resolved === "deleting") {
      batch.skippedDeleting += 1;
    } else if (resolved === "hasCards") {
      batch.skippedHasCards += 1;
    }
    return resolved === "gone";
  };
};

// The same keys the deletion workflow's export batch deletes.
const exportKeys = (job: Doc<"exportJobs">) =>
  job.artifactKey
    ? [
        job.artifactKey,
        `${job.artifactKey}.checkpoint.json`,
        `${job.artifactKey}.result.json`,
      ]
    : [];

const queueKeys = async (
  ctx: MutationCtx,
  keys: string[],
  dryRun: boolean,
  batch: Totals
) => {
  if (dryRun) {
    batch.objectKeysQueued += new Set(keys.filter(Boolean)).size;
  } else {
    batch.objectKeysQueued += await enqueueObjectDeletion(ctx, keys);
  }
};

const sumTotals = (previous: Totals, batch: Totals) =>
  Object.fromEntries(
    Object.entries(batch).map(([name, value]) => [
      name,
      previous[name as keyof Totals] + value,
    ])
  ) as Totals;

const pageArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  dryRun: v.optional(v.boolean()),
  batchSize: v.optional(v.number()),
  once: v.optional(v.boolean()),
  totals: v.optional(totalsValidator),
};
const pageReturns = v.object({
  dryRun: v.boolean(),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
  continuationScheduled: v.boolean(),
  batch: totalsValidator,
  totals: totalsValidator,
});
const batchSizeOf = (value: number | undefined) =>
  Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Math.floor(value ?? DEFAULT_BATCH_SIZE))
  );

export const cleanupOrphanedExports = internalMutation({
  args: pageArgs,
  returns: pageReturns,
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = batchSizeOf(args.batchSize);
    const page = await ctx.db
      .query("exportJobs")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const batch = emptyTotals();
    const isGone = ownerGate(ctx, batch);
    for (const job of page.page) {
      batch.examined += 1;
      if (!(await isGone(job.userId))) {
        continue;
      }
      const items = await ctx.db
        .query("exportJobItems")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .take(ITEM_PAGE + 1);
      if (items.length > ITEM_PAGE) {
        batch.skippedIncomplete += 1;
        continue;
      }
      await queueKeys(ctx, exportKeys(job), dryRun, batch);
      batch.exportJobItemsDeleted += items.length;
      batch.exportJobsDeleted += 1;
      if (!dryRun) {
        for (const item of items) {
          await ctx.db.delete("exportJobItems", item._id);
        }
        await ctx.db.delete("exportJobs", job._id);
      }
    }
    return finishPage(ctx, args, page, batch, dryRun, batchSize, "exports");
  },
});

export const cleanupOrphanedStorageObjects = internalMutation({
  args: pageArgs,
  returns: pageReturns,
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = batchSizeOf(args.batchSize);
    const page = await ctx.db
      .query("accountStorageObjects")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const batch = emptyTotals();
    const isGone = ownerGate(ctx, batch);
    const keys: string[] = [];
    for (const object of page.page) {
      batch.examined += 1;
      if (!(await isGone(object.userId))) {
        continue;
      }
      keys.push(object.key);
      batch.storageObjectsDeleted += 1;
      if (!dryRun) {
        await ctx.db.delete("accountStorageObjects", object._id);
      }
    }
    await queueKeys(ctx, keys, dryRun, batch);
    return finishPage(ctx, args, page, batch, dryRun, batchSize, "objects");
  },
});

const finishPage = async (
  ctx: MutationCtx,
  args: { once?: boolean; totals?: Totals },
  page: { isDone: boolean; continueCursor: string },
  batch: Totals,
  dryRun: boolean,
  batchSize: number,
  kind: "exports" | "objects"
) => {
  const totals = sumTotals(args.totals ?? emptyTotals(), batch);
  const continuationScheduled = !(page.isDone || args.once);
  if (continuationScheduled) {
    const next =
      kind === "exports"
        ? internal["migration/cleanupOrphanedAccountFiles"]
            .cleanupOrphanedExports
        : internal["migration/cleanupOrphanedAccountFiles"]
            .cleanupOrphanedStorageObjects;
    await ctx.scheduler.runAfter(0, next, {
      cursor: page.continueCursor,
      dryRun,
      batchSize,
      totals,
    });
  } else if (page.isDone) {
    console.log(`cleanupOrphanedAccountFiles ${kind} finished`, {
      dryRun,
      ...totals,
    });
  }
  return {
    dryRun,
    isDone: page.isDone,
    continueCursor: page.isDone ? null : page.continueCursor,
    continuationScheduled,
    batch,
    totals,
  };
};
