import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { IMPORT_CARD_BATCH } from "../import/constants";
import { workflow } from "./manager";

const internalAny = internal as Record<string, any>;

async function failRemaining(
  step: any,
  jobId: string,
  code: string,
  reason: string
) {
  for (;;) {
    const result = await step.runMutation(
      internalAny.dataImport.failPendingPage,
      { jobId, code, reason, limit: 100 }
    );
    if (!result.count) {
      return;
    }
  }
}

async function finalize(
  step: any,
  jobId: string,
  status: "completed" | "failed" | "canceled",
  failureClass?: string
) {
  const objects = await step.runAction(
    internalAny["import/runImport"].finalizeImportObjects,
    { jobId }
  );
  await step.runMutation(internalAny.dataImport.finishJob, {
    jobId,
    status,
    reportKey: objects.reportKey,
    failureClass,
  });
  return { status };
}

export const importWorkflow = workflow.define({
  args: { jobId: v.id("importJobs") },
  returns: v.object({
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
  }),
  handler: async (step, { jobId }) => {
    const parsing = await step.runMutation(internalAny.dataImport.setPhase, {
      jobId,
      status: "parsing",
      phase: "Parsing import file",
    });
    if (parsing.canceled) {
      return finalize(step, jobId, "canceled");
    }

    const indexed = await step.runAction(
      internalAny["import/runImport"].indexImportSource,
      { jobId }
    );
    if (!indexed.ok) {
      return finalize(
        step,
        jobId,
        "failed",
        indexed.failureClass ?? "parse_failed"
      );
    }

    const importing = await step.runMutation(internalAny.dataImport.setPhase, {
      jobId,
      status: "importing",
      phase: "Importing cards",
    });
    if (importing.canceled) {
      return finalize(step, jobId, "canceled");
    }

    for (;;) {
      const job = await step.runQuery(internalAny.dataImport.getJob, { jobId });
      if (!job || job.cancelRequested) {
        return finalize(step, jobId, "canceled");
      }
      const items = await step.runQuery(
        internalAny.dataImport.getPendingItems,
        { jobId, limit: IMPORT_CARD_BATCH }
      );
      if (!items.length) {
        return finalize(step, jobId, "completed");
      }

      const fileItems = items.filter(
        (item: any) => item.filePath && !item.extractedFileKey
      );
      if (fileItems.length) {
        const extracted = await step.runAction(
          internalAny["import/runImport"].extractImportFiles,
          { jobId, itemIds: fileItems.map((item: any) => item._id) }
        );
        if (!extracted.ok) {
          await step.runMutation(internalAny.dataImport.failItems, {
            jobId,
            itemIds: fileItems.map((item: any) => item._id),
            code: "FILE_EXTRACT_FAILED",
            reason: extracted.failureClass ?? "File could not be extracted",
          });
          continue;
        }
      }

      const result = await step.runMutation(
        internalAny.dataImport.createPendingBatch,
        { jobId, itemIds: items.map((item: any) => item._id) }
      );
      if (result.limitReached) {
        await failRemaining(
          step,
          jobId,
          "CARD_LIMIT_REACHED",
          "Your card limit was reached"
        );
        return finalize(step, jobId, "completed");
      }
      if (result.retryAt) {
        await step.sleep(Math.max(1000, result.retryAt - Date.now()), {
          name: "card-rate-limit",
        });
      }
    }
  },
});

export const startImportWorkflow = internalMutation({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, { jobId }) => {
    const workflowId = await workflow.start(
      ctx,
      internalAny["workflows/import"].importWorkflow,
      { jobId },
      { startAsync: true }
    );
    await ctx.db.patch(jobId, {
      workflowId: String(workflowId),
      updatedAt: Date.now(),
    });
    return { workflowId: String(workflowId) };
  },
});
