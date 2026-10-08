import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import {
  captureDeletionBatch,
  commitDeletionBatch,
} from "./accountDeletionBatch";
import { callFilesWorkerJson } from "./storage/filesWorkerClient";
import { assertR2KeyInNamespace } from "./storage/r2Keys";
import { workflow } from "./workflows/manager";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
export const deleteKeys = internalAction({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { keys }) => {
    if (keys.length > 500) {
      throw new Error("deletion_key_batch_limit");
    }
    for (const key of keys) {
      assertR2KeyInNamespace(key);
    }
    for (const key of new Set(keys)) {
      const frozen = await callFilesWorkerJson<{ frozen: boolean }>({
        op: "freeze-object",
        params: { key },
      });
      if (frozen.kind !== "ok" || !frozen.data.frozen) {
        throw new Error("deletion_object_write_pending");
      }
    }
    // Missing objects succeed. Real Worker/R2 failures throw and retain rows/evidence.
    await ctx.runAction(
      internal["workflows/objectCleanup"].deleteObjectsAction,
      { keys }
    );
    return null;
  },
});
export const cancelJobsPage = internalMutation({
  args: {
    ...bindingArgs,
    table: v.union(v.literal("importJobs"), v.literal("exportJobs")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { table, cursor, ...binding }) => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
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
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (
      state.stage !== 3 ||
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
export const prepareWriters = internalAction({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding): Promise<boolean> => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== 3) {
      throw new Error("stale_deletion_stage");
    }
    if (state.writersPrepared) {
      return true;
    }
    const table = state.writerTable ?? "importJobs";
    const previous = state.writerCursor ?? null;
    const page: { done: boolean; cursor: string; workflowIds: string[] } =
      await ctx.runMutation(internal.accountDeletionData.cancelJobsPage, {
        ...binding,
        table,
        cursor: previous,
      });
    for (const id of page.workflowIds) {
      const status = await workflow.status(
        ctx,
        id as Parameters<typeof workflow.status>[1]
      );
      if (status.type === "inProgress") {
        throw new Error("deletion_job_still_running");
      }
    }
    await ctx.runMutation(internal.accountDeletionData.checkpointWriters, {
      ...binding,
      table,
      previous,
      next: page.cursor,
      done: page.done,
    });
    return table === "exportJobs" && page.done;
  },
});
export const ancillaryPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding) => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== 3) {
      throw new Error("stale_deletion_stage");
    }
    const userId = state.userId;
    const idempotency = await ctx.db
      .query("apiIdempotencyKeys")
      .withIndex("by_user_key_hash", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of idempotency) {
      await ctx.db.delete(row._id);
    }
    return idempotency.length > 0;
  },
});
export const deleteRemainingData = internalAction({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding): Promise<boolean> => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== 3 || !state.writersPrepared) {
      throw new Error("stale_deletion_stage");
    }
    for (const kind of ["exports", "uploads", "objects"] as const) {
      const empty: boolean = await ctx.runAction(
        internal.accountDeletionData.drainStorageBatch,
        { ...binding, kind }
      );
      if (!empty) {
        return false;
      }
    }
    return !(await ctx.runMutation(
      internal.accountDeletionData.ancillaryPage,
      binding
    ));
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
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== 3 || !state.writersPrepared) {
      throw new Error("stale_deletion_stage");
    }
    const batch = await captureDeletionBatch(ctx, state.userId, kind);
    const progress = state.storageProgress;
    if (!batch.rows.length) {
      if (progress?.kind === kind) {
        throw new Error("deletion_storage_source_changed");
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
      throw new Error("deletion_storage_source_changed");
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
      keys: batch.keys.slice(offset, offset + 3),
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
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    const progress = state.storageProgress;
    if (
      state.stage !== 3 ||
      !progress ||
      progress.kind !== kind ||
      progress.fingerprint !== fingerprint ||
      progress.offset !== offset ||
      count < 0 ||
      count > 3 ||
      !Number.isInteger(count)
    ) {
      throw new Error("stale_deletion_storage_page");
    }
    const batch = await captureDeletionBatch(ctx, state.userId, kind);
    if (
      batch.fingerprint !== fingerprint ||
      count !== Math.min(3, batch.keys.length - offset)
    ) {
      throw new Error("deletion_storage_source_changed");
    }
    const next = offset + count;
    if (next < batch.keys.length) {
      await ctx.db.patch(state._id, {
        storageProgress: { ...progress, offset: next },
      });
      return false;
    }
    await commitDeletionBatch(ctx, kind, state.userId, batch.rows);
    await ctx.db.patch(state._id, { storageProgress: undefined });
    return true;
  },
});
export const drainStorageBatch = internalAction({
  args: { ...bindingArgs, kind: batchKind },
  returns: v.boolean(),
  handler: async (ctx, { kind, ...binding }): Promise<boolean> => {
    const page: {
      empty: boolean;
      fingerprint: string;
      offset: number;
      keys: string[];
      aborts: { key: string; uploadId: string }[];
    } = await ctx.runMutation(
      internal.accountDeletionData.prepareStorageBatch,
      { ...binding, kind }
    );
    if (page.empty) {
      return true;
    }
    for (const abort of page.aborts) {
      const result = await callFilesWorkerJson({
        op: "abort-multipart",
        params: abort,
      });
      if (result.kind !== "ok") {
        throw new Error("deletion_upload_abort_failed");
      }
    }
    await ctx.runAction(internal.accountDeletionData.deleteKeys, {
      keys: page.keys,
    });
    await ctx.runMutation(internal.accountDeletionData.checkpointStorageBatch, {
      ...binding,
      kind,
      fingerprint: page.fingerprint,
      offset: page.offset,
      count: page.keys.length,
    });
    // Even the last batch yields; the next invocation proves the source empty.
    return false;
  },
});
