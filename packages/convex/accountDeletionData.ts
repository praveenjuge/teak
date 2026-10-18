import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  captureDeletionBatch,
  commitDeletionBatch,
} from "./accountDeletionBatch";
import {
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  accountDeletionStage,
} from "./accountDeletionStages";
import { deleteCardTombstonesForUserPage } from "./publicApiTombstones";

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
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== accountDeletionStage("accountData")) {
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
    const moreTombstones = await deleteCardTombstonesForUserPage(
      ctx,
      userId,
      100
    );
    const folderRows = await ctx.db
      .query("folderCards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of folderRows) {
      await ctx.db.delete(row._id);
    }
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(100);
    for (const folder of folders) {
      await ctx.db.delete(folder._id);
    }
    const tagSummaries = await ctx.db
      .query("userTagSummaries")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    for (const row of tagSummaries) {
      await ctx.db.delete(row._id);
    }
    const tagRefreshes = await ctx.db
      .query("tagSummaryRefreshes")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    for (const row of tagRefreshes) {
      await ctx.db.delete(row._id);
    }
    const tagOperations = await ctx.db
      .query("tagOperations")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of tagOperations) {
      await ctx.db.delete(row._id);
    }
    const vaultSetups = await ctx.db
      .query("vaultSetups")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    for (const row of vaultSetups) {
      await ctx.db.delete(row._id);
    }
    const vectorShards = await ctx.db
      .query("vectorShards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    for (const row of vectorShards) {
      await ctx.db.delete(row._id);
    }
    const semanticResults = await ctx.db
      .query("semanticSearchResults")
      .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of semanticResults) {
      await ctx.db.delete(row._id);
    }
    const relevanceResults = await ctx.db
      .query("searchRelevanceResults")
      .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of relevanceResults) {
      await ctx.db.delete(row._id);
    }
    const linkedPdfs = await ctx.db
      .query("linkedPdfs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of linkedPdfs) {
      await ctx.db.delete(row._id);
    }
    const inboundSettings = await ctx.db
      .query("inboundEmailSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(10);
    for (const row of inboundSettings) {
      await ctx.db.delete(row._id);
    }
    const inboundReceipts = await ctx.db
      .query("inboundEmailReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of inboundReceipts) {
      await ctx.db.delete(row._id);
    }
    return (
      inboundSettings.length > 0 ||
      inboundReceipts.length > 0 ||
      linkedPdfs.length > 0 ||
      vaultSetups.length > 0 ||
      semanticResults.length > 0 ||
      relevanceResults.length > 0 ||
      vectorShards.length > 0 ||
      idempotency.length > 0 ||
      moreTombstones ||
      folderRows.length > 0 ||
      folders.length > 0 ||
      tagSummaries.length > 0 ||
      tagRefreshes.length > 0 ||
      tagOperations.length > 0
    );
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
    if (
      state.stage !== accountDeletionStage("accountData") ||
      !state.writersPrepared
    ) {
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
      state.stage !== accountDeletionStage("accountData") ||
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
    // Each checkpoint is progress, so a long drain never reads as stalled.
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
