import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertAccountNotDeleting } from "../accountDeletion";
import { newImportFolderCache } from "../folder/folders";
import { resolveStoredUserId } from "../securitySessions";
import { enqueueObjectDeletion } from "../workflowDispatch";
import { createImportedCard, importItemFields } from "./items";

// The import Workflow keeps the items it reads in R2 under the job's key
// namespace (`importStagedPartKey`). Convex keeps the job's counts and
// position, and a row for each failed item, which the failure samples and
// the report read.

const failedItemValidator = v.object({
  ...importItemFields,
  failureCode: v.string(),
  failureReason: v.string(),
});

const stagedItemValidator = v.object({
  ...importItemFields,
  extractedFileKey: v.optional(v.string()),
});

const loadStagedJob = async (ctx: MutationCtx, jobId: Id<"importJobs">) => {
  const job = await ctx.db.get(jobId);
  if (!job) {
    throw new Error("Import job not found");
  }
  if (!job.stagedItems) {
    throw new Error("import_not_staged");
  }
  return { job, staged: job.stagedItems };
};

const insertFailedItem = (
  ctx: MutationCtx,
  job: Doc<"importJobs">,
  item: Infer<typeof failedItemValidator>
) => {
  const now = Date.now();
  return ctx.db.insert("importJobItems", {
    ...item,
    status: "failed",
    jobId: job._id,
    userId: job.userId,
    createdAt: now,
    updatedAt: now,
  });
};

/** Stores the failed items of one source page. A replay stores nothing new. */
export const recordFailures = internalMutation({
  args: { jobId: v.id("importJobs"), items: v.array(failedItemValidator) },
  returns: v.null(),
  handler: async (ctx, { jobId, items }) => {
    const { job } = await loadStagedJob(ctx, jobId);
    await assertAccountNotDeleting(ctx, job.userId);
    for (const item of items) {
      const exists = await ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) =>
          q.eq("jobId", jobId).eq("sourceIndex", item.sourceIndex)
        )
        .first();
      if (!exists) {
        await insertFailedItem(ctx, job, item);
      }
    }
    return null;
  },
});

/**
 * Counts one source page and the staged parts it writes next, before they
 * are written, so every cleanup knows their keys. Pages are recorded in
 * order; a replayed page changes nothing.
 */
export const recordPage = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    page: v.number(),
    cursor: v.number(),
    nextCursor: v.union(v.number(), v.null()),
    parts: v.number(),
    parsed: v.number(),
    skipped: v.number(),
    failed: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { job, staged } = await loadStagedJob(ctx, args.jobId);
    await assertAccountNotDeleting(ctx, job.userId);
    if (staged.pages >= args.page) {
      return null;
    }
    if (staged.pages !== args.page - 1 || staged.cursor !== args.cursor) {
      throw new Error("staged_page_out_of_order");
    }
    await ctx.db.patch(args.jobId, {
      parsedCount: job.parsedCount + args.parsed,
      processedCount: job.processedCount + args.skipped + args.failed,
      skippedCount: job.skippedCount + args.skipped,
      failedCount: job.failedCount + args.failed,
      stagedItems: {
        ...staged,
        pages: args.page,
        parts: staged.parts + args.parts,
        cursor: args.nextCursor,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Creates cards for a batch of staged items, all from part `part` starting
 * at `offset`. It runs only while the job is still at `from`, so a replayed
 * batch creates nothing twice, and moves the job past the items it handled.
 * An item that arrives with a failure (its file could not be extracted) is
 * recorded as failed.
 */
export const createBatch = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    from: v.object({ part: v.number(), offset: v.number() }),
    part: v.number(),
    offset: v.number(),
    items: v.array(stagedItemValidator),
  },
  returns: v.object({
    retryAt: v.optional(v.number()),
    limitReached: v.boolean(),
    failureClass: v.optional(v.literal("identity_mapping_unavailable")),
  }),
  handler: async (ctx, { jobId, from, part, offset, items }) => {
    const { job, staged } = await loadStagedJob(ctx, jobId);
    if (
      job.cancelRequested ||
      staged.part !== from.part ||
      staged.offset !== from.offset
    ) {
      return { limitReached: false };
    }
    const userId = await resolveStoredUserId(ctx, job.userId);
    if (!userId) {
      return {
        limitReached: false,
        failureClass: "identity_mapping_unavailable" as const,
      };
    }
    let created = 0,
      skipped = 0,
      failed = 0;
    const unclaimed: string[] = [];
    const settle = async (phase?: string) => {
      await ctx.db.patch(jobId, {
        processedCount: job.processedCount + created + skipped + failed,
        createdCount: job.createdCount + created,
        skippedCount: job.skippedCount + skipped,
        failedCount: job.failedCount + failed,
        stagedItems: {
          ...staged,
          part,
          offset: offset + created + skipped + failed,
        },
        ...(phase ? { phase } : {}),
        updatedAt: Date.now(),
      });
      await enqueueObjectDeletion(ctx, unclaimed);
    };
    const folderCache = newImportFolderCache();
    for (const { extractedFileKey, ...item } of items) {
      if (item.failureCode) {
        await insertFailedItem(ctx, job, {
          ...item,
          failureCode: item.failureCode,
          failureReason: item.failureReason ?? "Import failed",
        });
        failed += 1;
        unclaimed.push(...(extractedFileKey ? [extractedFileKey] : []));
        continue;
      }
      const outcome = await createImportedCard(
        ctx,
        job,
        userId,
        { ...item, extractedFileKey },
        folderCache
      );
      if (outcome.kind === "created") {
        created += 1;
        continue;
      }
      if (outcome.kind === "duplicate") {
        skipped += 1;
        unclaimed.push(...(extractedFileKey ? [extractedFileKey] : []));
        continue;
      }
      if (outcome.code === "RATE_LIMITED") {
        await settle("Waiting for card rate limit");
        return {
          retryAt: outcome.retryAt ?? Date.now() + 60_000,
          limitReached: false,
        };
      }
      await insertFailedItem(ctx, job, {
        ...item,
        failureCode: outcome.code ?? "CREATE_FAILED",
        failureReason: outcome.message ?? "Import failed",
      });
      failed += 1;
      unclaimed.push(...(extractedFileKey ? [extractedFileKey] : []));
      if (outcome.code === "CARD_LIMIT_REACHED") {
        await settle();
        return { limitReached: true };
      }
    }
    await settle();
    return { limitReached: false };
  },
});
