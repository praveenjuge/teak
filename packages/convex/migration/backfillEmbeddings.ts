import { vectorNamespaceForUser } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { queueCardEmbedding } from "../embedding/state";
import { buildEmbeddingText } from "../embedding/text";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { getR2KeyPrefix } from "../storage/r2Keys";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
/**
 * Queued cards are embedded in jobs of this many, one job this far apart:
 * about 300 cards a minute in few Vectorize writes (many small writes get
 * 429s). Kept small so one job reads little stored text.
 */
const EMBED_JOB_SIZE = 16;
const EMBED_JOB_SPACING_MS = 3200;
/** A row due this long ago has lost its job: queue it again. */
const LOST_JOB_MS = 60 * 60 * 1000;

const totalsValidator = v.object({
  examined: v.number(),
  /** Cards with no text to embed yet (an image still waiting for AI). */
  noText: v.number(),
  /** Cards whose vector was recorded; queued only with `reembed`. */
  embedded: v.number(),
  /** Cards already waiting for their embed. */
  pending: v.number(),
  /** Cards with text and no vector: saved before embeddings, or a lost job. */
  missing: v.number(),
  /** Cards whose embed ran out of retries. */
  failed: v.number(),
  /** Cards queued (a dry run counts what it would queue). */
  queued: v.number(),
  /** Cards whose owner's id is too long to name a Vectorize namespace. */
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

/**
 * Queues an embed for every card with text and no current vector: cards
 * saved before embeddings shipped, cards whose embed ran out of retries,
 * and cards whose job was lost. `reembed` also queues embedded cards; their
 * embed costs no Workers AI call unless the text, the card type or
 * `CARD_EMBEDDING_VERSION` changed, so run it after bumping the version, and
 * once to write the type onto vectors from before they carried one. `force`
 * also forgets each hash, so every vector is written again even when nothing
 * changed: for vectors written before their index's `type` metadata index
 * existed, which Vectorize never indexes. Trashed and archived cards are
 * embedded too (search filters them).
 *
 * A dry run (the default) writes nothing and reports what a real run would
 * queue. Each batch schedules the next until the table is done, and the
 * last one logs the totals. A real run embeds about 300 cards a minute, in
 * jobs of 16.
 * `userId` limits it to one account, as a canary before the whole table.
 *
 *   npx convex run migration/backfillEmbeddings:backfillEmbeddings
 *   npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillEmbeddings:backfillEmbeddings '{"dryRun":false}'
 */
export const backfillEmbeddings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
    once: v.optional(v.boolean()),
    reembed: v.optional(v.boolean()),
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
      // A file's extracted text is enough on its own; reading it would cost
      // up to 512 KiB a card.
      if (!(card.hasExtractedText || buildEmbeddingText(card))) {
        batch.noText += 1;
        continue;
      }
      const row = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_cardId", (q) => q.eq("cardId", card._id))
        .unique();
      if (row?.pendingVectorDeleteAt !== undefined) {
        // The card is being deleted.
        continue;
      }
      if (row?.dueAt !== undefined && row.dueAt > now - LOST_JOB_MS) {
        batch.pending += 1;
        continue;
      }
      // A failed re-embed keeps the old hash (and vector): check the error
      // first, or it would pass for embedded.
      if (row?.lastError !== undefined && row.dueAt === undefined) {
        batch.failed += 1;
      } else if (row?.hash !== undefined && row.dueAt === undefined) {
        batch.embedded += 1;
        if (!(args.reembed || args.force)) {
          continue;
        }
      } else {
        batch.missing += 1;
      }
      if (!vectorNamespaceForUser(`${getR2KeyPrefix()}${card.userId}`)) {
        batch.invalidNamespace += 1;
        continue;
      }
      // Account deletion owns these rows while it runs.
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
      // The next batch starts as this one's last job is due.
      await ctx.scheduler.runAfter(
        jobs.length * EMBED_JOB_SPACING_MS,
        internal.migration.backfillEmbeddings.backfillEmbeddings,
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
