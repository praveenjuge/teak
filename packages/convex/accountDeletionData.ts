import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  ACCOUNT_DELETION_KEY_PAGE,
  captureDeletionBatch,
  commitDeletionBatch,
  isCurrentDeletionFingerprint,
} from "./accountDeletion/batch";
import {
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  accountDeletionFailure,
  accountDeletionStage,
} from "./accountDeletion/stages";
import { SWEPT_TABLES, sweepAccountRows } from "./accountDeletion/tables";
import { readDeletionState } from "./accountDeletionJobs";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
export const cancelJobsPage = internalMutation({
  args: {
    ...bindingArgs,
    table: v.union(v.literal("importJobs"), v.literal("exportJobs")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { table, cursor, ...binding }) => {
    const state = await readDeletionState(ctx, binding);
    const page =
      table === "importJobs"
        ? await ctx.db
            .query("importJobs")
            .withIndex("by_user_created", (q) => q.eq("userId", state.userId))
            .paginate({ cursor, numItems: 20 })
        : await ctx.db
            .query("exportJobs")
            .withIndex("by_user_created", (q) => q.eq("userId", state.userId))
            .paginate({ cursor, numItems: 20 });
    for (const row of page.page) {
      await ctx.db.patch(row._id, { cancelRequested: true });
    }
    return {
      done: page.isDone,
      cursor: page.continueCursor,
      workflowIds: page.page.flatMap((row) =>
        row.workflowId ? [row.workflowId] : []
      ),
    };
  },
});
export const checkpointWriters = internalMutation({
  args: {
    ...bindingArgs,
    table: v.union(v.literal("importJobs"), v.literal("exportJobs")),
    previous: v.union(v.string(), v.null()),
    next: v.string(),
    done: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { table, previous, next, done, ...binding }) => {
    const state = await readDeletionState(ctx, binding);
    if (
      state.stage !== accountDeletionStage("accountData") ||
      state.writersPrepared ||
      (state.writerTable ?? "importJobs") !== table ||
      (state.writerCursor ?? null) !== previous
    ) {
      throw new Error("stale_deletion_writer_page");
    }
    if (!done) {
      await ctx.db.patch(state._id, { writerTable: table, writerCursor: next });
    } else if (table === "importJobs") {
      await ctx.db.patch(state._id, {
        writerTable: "exportJobs",
        writerCursor: undefined,
      });
    } else {
      await ctx.db.patch(state._id, { writersPrepared: true });
    }
    return null;
  },
});
export const ancillaryPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding) => {
    const state = await readDeletionState(ctx, binding);
    if (state.stage !== accountDeletionStage("accountData")) {
      throw new Error("stale_deletion_stage");
    }
    let deletedAny = false;
    for (const swept of SWEPT_TABLES) {
      deletedAny =
        (await sweepAccountRows(ctx, swept, state.userId)) > 0 || deletedAny;
    }
    return deletedAny;
  },
});
const batchKind = v.union(
  v.literal("cards"),
  v.literal("imports"),
  v.literal("exports"),
  v.literal("uploads"),
  v.literal("objects")
);
export const prepareStorageBatch = internalMutation({
  args: { ...bindingArgs, kind: batchKind },
  handler: async (ctx, { kind, ...binding }) => {
    const state = await readDeletionState(ctx, binding);
    if (
      state.stage !== accountDeletionStage("accountData") ||
      !state.writersPrepared
    ) {
      throw new Error("stale_deletion_stage");
    }
    const batch = await captureDeletionBatch(ctx, state.userId, kind);
    // Progress a deploy left behind under the older, row-hashing fingerprint
    // restarts the batch; deleting its keys again is harmless.
    const progress =
      batch.rows.length > 0 &&
      state.storageProgress?.kind === kind &&
      !isCurrentDeletionFingerprint(state.storageProgress.fingerprint)
        ? undefined
        : state.storageProgress;
    if (!batch.rows.length) {
      if (progress?.kind === kind) {
        throw accountDeletionFailure("deletion_storage_source_changed");
      }
      return {
        empty: true,
        fingerprint: batch.fingerprint,
        offset: 0,
        keys: [],
        aborts: [],
      };
    }
    if (
      progress &&
      (progress.kind !== kind || progress.fingerprint !== batch.fingerprint)
    ) {
      throw accountDeletionFailure("deletion_storage_source_changed");
    }
    const offset = progress?.offset ?? 0;
    if (!progress) {
      await ctx.db.patch(state._id, {
        storageProgress: { kind, fingerprint: batch.fingerprint, offset },
      });
    }
    return {
      empty: false,
      fingerprint: batch.fingerprint,
      offset,
      keys: batch.keys.slice(offset, offset + ACCOUNT_DELETION_KEY_PAGE),
      aborts: offset === 0 ? batch.aborts : [],
    };
  },
});
export const checkpointStorageBatch = internalMutation({
  args: {
    ...bindingArgs,
    kind: batchKind,
    fingerprint: v.string(),
    offset: v.number(),
    count: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { kind, fingerprint, offset, count, ...binding }) => {
    const state = await readDeletionState(ctx, binding);
    const progress = state.storageProgress;
    if (
      state.stage !== accountDeletionStage("accountData") ||
      !progress ||
      progress.kind !== kind ||
      progress.fingerprint !== fingerprint ||
      progress.offset !== offset ||
      count < 0 ||
      count > ACCOUNT_DELETION_KEY_PAGE ||
      !Number.isInteger(count)
    ) {
      throw new Error("stale_deletion_storage_page");
    }
    const batch = await captureDeletionBatch(ctx, state.userId, kind);
    if (
      batch.fingerprint !== fingerprint ||
      count !== Math.min(ACCOUNT_DELETION_KEY_PAGE, batch.keys.length - offset)
    ) {
      throw accountDeletionFailure("deletion_storage_source_changed");
    }
    const next = offset + count;
    const nextAttemptAt = Date.now() + ACCOUNT_DELETION_PROGRESS_GRACE_MS;
    if (next < batch.keys.length) {
      await ctx.db.patch(state._id, {
        storageProgress: { ...progress, offset: next },
        nextAttemptAt,
      });
      return false;
    }
    await commitDeletionBatch(ctx, batch);
    await ctx.db.patch(state._id, {
      storageProgress: undefined,
      nextAttemptAt,
    });
    return true;
  },
});
