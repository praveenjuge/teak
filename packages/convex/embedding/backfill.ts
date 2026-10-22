import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { classifyEmbeddingRow, queueCardEmbedding } from "./state";
import { buildEmbeddingText } from "./text";
import { userVectorNamespace } from "./userVectors";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
// Vectorize answers many small writes with 429s, so queued cards go out in
// jobs of a few cards, spaced apart.
const EMBED_JOB_SIZE = 16;
const EMBED_JOB_SPACING_MS = 3200;

const totalsValidator = v.object({
  examined: v.number(),
  noText: v.number(),
  embedded: v.number(),
  pending: v.number(),
  missing: v.number(),
  failed: v.number(),
  queued: v.number(),
  invalidNamespace: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  noText: 0,
  embedded: 0,
  pending: 0,
  missing: 0,
  failed: 0,
  queued: 0,
  invalidNamespace: 0,
  skippedDeletingAccounts: 0,
});

export const backfillEmbeddings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    reembed: v.optional(v.boolean()),
    // Vectorize never indexes a vector written before its index's `type`
    // metadata index existed: `force` writes every vector again.
    force: v.optional(v.boolean()),
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

    const now = Date.now();
    const batch = emptyTotals();
    const jobs: Id<"cards">[][] = [];
    const deletingAccounts = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      if (!(card.hasExtractedText || buildEmbeddingText(card))) {
        batch.noText += 1;
        continue;
      }
      const row = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_cardId", (q) => q.eq("cardId", card._id))
        .unique();
      const state = classifyEmbeddingRow(row, now);
      if (state === "deleting") {
        continue;
      }
      if (state === "pending") {
        batch.pending += 1;
        continue;
      }
      if (state === "failed") {
        batch.failed += 1;
      } else if (state === "embedded") {
        batch.embedded += 1;
        if (!(args.reembed || args.force)) {
          continue;
        }
      } else {
        batch.missing += 1;
      }
      if (!userVectorNamespace(card.userId)) {
        batch.invalidNamespace += 1;
        continue;
      }
      let deleting = deletingAccounts.get(card.userId);
      if (deleting === undefined) {
        deleting = Boolean(await getAccountDeletionState(ctx, card.userId));
        deletingAccounts.set(card.userId, deleting);
      }
      if (deleting) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (!dryRun) {
        const job = jobs[jobs.length - 1];
        if (job && job.length < EMBED_JOB_SIZE) {
          job.push(card._id);
        } else {
          jobs.push([card._id]);
        }
        await queueCardEmbedding(
          ctx,
          row,
          card._id,
          card.userId,
          now + (jobs.length - 1) * EMBED_JOB_SPACING_MS,
          { forgetHash: args.force === true }
        );
      }
      batch.queued += 1;
    }
    for (const [index, cardIds] of jobs.entries()) {
      await ctx.scheduler.runAfter(
        index * EMBED_JOB_SPACING_MS,
        internal.embedding.embedCard.embedDue,
        { cardIds }
      );
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
        jobs.length * EMBED_JOB_SPACING_MS,
        internal.embedding.backfill.backfillEmbeddings,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(args.reembed ? { reembed: true } : {}),
          ...(args.force ? { force: true } : {}),
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillEmbeddings finished", {
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
