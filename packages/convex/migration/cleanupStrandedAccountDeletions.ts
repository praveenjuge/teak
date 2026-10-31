import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { countActiveKeysForOwner, revokeActiveKeysPage } from "../apiKeys";
import { enqueueObjectDeletion } from "../workflowDispatch";

// Before WorkOS, the E2E cleanup started an account deletion and then removed
// the Better Auth user without the hook that finished it, so each run left an
// `accountDeletionStates` row with only `userId` and `startedAt`. Nothing
// resumes such a row, and the deletion workflow can't take it: it needs a
// generation and a `users` row bound to WorkOS. This removes what those
// deletions left behind (API keys, exports, tracked storage objects), then the
// row. It never calls WorkOS or Polar.

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;
const OBJECT_PAGE = 100;
const EXPORT_PAGE = 50;

const totalsValidator = v.object({
  examined: v.number(),
  skippedCurrent: v.number(),
  skippedLiveUser: v.number(),
  skippedHasCards: v.number(),
  apiKeysRevoked: v.number(),
  exportJobsDeleted: v.number(),
  exportJobItemsDeleted: v.number(),
  storageObjectsDeleted: v.number(),
  objectKeysQueued: v.number(),
  statesDeleted: v.number(),
  statesIncomplete: v.number(),
});
type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  skippedCurrent: 0,
  skippedLiveUser: 0,
  skippedHasCards: 0,
  apiKeysRevoked: 0,
  exportJobsDeleted: 0,
  exportJobItemsDeleted: 0,
  storageObjectsDeleted: 0,
  objectKeysQueued: 0,
  statesDeleted: 0,
  statesIncomplete: 0,
});

const isStranded = (state: Doc<"accountDeletionStates">) =>
  state.generation === undefined &&
  state.stage === undefined &&
  state.workflowId === undefined &&
  state.workosUserId === undefined &&
  state.initiationProvider === undefined;

const cleanUpState = async (
  ctx: MutationCtx,
  state: Doc<"accountDeletionStates">,
  dryRun: boolean,
  batch: Totals
) => {
  const { userId } = state;
  if (!isStranded(state)) {
    batch.skippedCurrent += 1;
    return;
  }
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .take(5);
  if (owners.some((owner) => owner.deletedAt === undefined)) {
    batch.skippedLiveUser += 1;
    return;
  }
  // Cards belong to the deletion workflow, which removes their search,
  // tag, folder and vector rows too; this cleanup only handles accounts
  // whose cards are already gone.
  const card = await ctx.db
    .query("cards")
    .withIndex("by_created", (q) => q.eq("userId", userId))
    .first();
  if (card) {
    batch.skippedHasCards += 1;
    return;
  }

  let incomplete = false;
  if (dryRun) {
    const active = await countActiveKeysForOwner(ctx, userId);
    batch.apiKeysRevoked += active;
  } else {
    const keys = await revokeActiveKeysPage(ctx, userId);
    batch.apiKeysRevoked += keys.revoked;
    incomplete ||= keys.more;
  }

  const exports = await ctx.db
    .query("exportJobs")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .take(EXPORT_PAGE + 1);
  const exportItems = await ctx.db
    .query("exportJobItems")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(OBJECT_PAGE + 1);
  const objects = await ctx.db
    .query("accountStorageObjects")
    .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
    .take(OBJECT_PAGE + 1);
  incomplete ||=
    exports.length > EXPORT_PAGE ||
    exportItems.length > OBJECT_PAGE ||
    objects.length > OBJECT_PAGE;
  const exportRows = exports.slice(0, EXPORT_PAGE);
  const itemRows = exportItems.slice(0, OBJECT_PAGE);
  const objectRows = objects.slice(0, OBJECT_PAGE);

  // The same keys the deletion workflow's export and object batches delete.
  const keys = [
    ...objectRows.map((row) => row.key),
    ...exportRows.flatMap((row) =>
      row.artifactKey
        ? [
            row.artifactKey,
            `${row.artifactKey}.checkpoint.json`,
            `${row.artifactKey}.result.json`,
          ]
        : []
    ),
  ];
  batch.exportJobsDeleted += exportRows.length;
  batch.exportJobItemsDeleted += itemRows.length;
  batch.storageObjectsDeleted += objectRows.length;
  if (dryRun) {
    batch.objectKeysQueued += new Set(keys).size;
  } else {
    batch.objectKeysQueued += await enqueueObjectDeletion(ctx, keys);
    for (const row of [...itemRows, ...exportRows, ...objectRows]) {
      await ctx.db.delete(row._id);
    }
  }

  if (incomplete) {
    // A later run finishes this account before deleting its row.
    batch.statesIncomplete += 1;
    return;
  }
  batch.statesDeleted += 1;
  if (!dryRun) {
    await ctx.db.delete("accountDeletionStates", state._id);
  }
};

export const cleanupStrandedAccountDeletions = internalMutation({
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
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const page = await ctx.db
      .query("accountDeletionStates")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = emptyTotals();
    for (const state of page.page) {
      batch.examined += 1;
      await cleanUpState(ctx, state, dryRun, batch);
    }

    const previous = args.totals ?? emptyTotals();
    const totals = Object.fromEntries(
      Object.entries(batch).map(([name, value]) => [
        name,
        previous[name as keyof Totals] + value,
      ])
    ) as Totals;
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/cleanupStrandedAccountDeletions"]
          .cleanupStrandedAccountDeletions,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("cleanupStrandedAccountDeletions finished", {
        dryRun,
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
