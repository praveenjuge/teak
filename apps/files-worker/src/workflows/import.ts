import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  IMPORT_CARD_BATCH,
  IMPORT_FAILURE,
  IMPORT_INDEX_BATCH,
  type ImportMode,
} from "@teak/convex/import/constants";
import {
  type ImportIndexItem,
  importFileKey,
  importReportKey,
  importStoredContentType,
  normalizeIndexItem,
} from "@teak/convex/import/indexItems";
import { assertImportCardCount } from "@teak/convex/import/validate";
import { CARD_ERROR_MESSAGES } from "@teak/convex/shared/constants";
import { isMarkdownFileName } from "@teak/convex/shared/markdown";
import type {
  FilesImportIndexResult,
  FilesImportMarkdownResult,
} from "@teak/files-protocol";
import type { FunctionReturnType } from "convex/server";
import { queueObjectDeletions } from "../queues/objectDeletions";
import { reportBackgroundError } from "../telemetry";
import {
  isTransientError,
  resolveDeps,
  settleConvexErrors,
  type WorkflowDeps,
  withinBudget,
} from "./deps";
import { gatedEnv } from "./filesOps";
import {
  CONVEX_STEP,
  errorMessage,
  retryConfig,
  runReported,
  type StepConfig,
  stopRun,
  type WorkflowRun,
} from "./runtime";

// Imports a source file the user uploaded: indexes it into importJobItems
// page by page, extracts archive files, creates the cards in small batches
// (sleeping through the card rate limit), then deletes the source and writes
// a report of the items that failed. Every phase resumes from the job row and
// its pending items, so a replayed or restarted run repeats nothing.

export interface ImportParams {
  jobId: string;
}

export type ImportOutcome = "canceled" | "completed" | "failed";

type WorkflowJob = NonNullable<
  FunctionReturnType<typeof internal.dataImport.getWorkflowJob>
>;

interface PendingItem {
  _id: Id<"importJobItems">;
  extractedFileKey?: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
}

type Outcome<T = object> =
  | ({ ok: true } & T)
  | { failureClass: string; ok: false };

type BatchOutcome =
  | { kind: "canceled" }
  | { kind: "done" }
  | { failureClass: string; kind: "failed" }
  | { kind: "more" }
  | { delayMs: number; kind: "sleep" };

const IMPORT_STEP: StepConfig = {
  retries: { backoff: "exponential", delay: "10 seconds", limit: 5 },
  timeout: "10 minutes",
};
const FINALIZE_STEP = retryConfig(3, 500);
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);
/** insertItems calls stay well under the RPC body limit. */
const INSERT_BATCH_BYTES = 2 * 1024 * 1024;
const MARKDOWN_READS_AT_ONCE = 8;
const REPORT_PAGE_SIZE = 200;
const UNCLAIMED_PAGE_SIZE = 200;

const reportLabel = (text: string) =>
  text.length > 1024 ? `${text.slice(0, 1024)}…` : text;

const failureClassOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.slice(0, 160) : fallback;

export const runImport = (
  run: WorkflowRun<ImportParams>,
  deps: WorkflowDeps = {}
): Promise<{ status: ImportOutcome }> => {
  const { convex, ops } = resolveDeps(run, deps);
  const { env, step } = run;
  const jobId = run.params.jobId as Id<"importJobs">;

  const loadJob = () =>
    convex.query(internal.dataImport.getWorkflowJob, { jobId });

  const ensureOwned = async (userId: string, key: string) => {
    if (
      !(await convex.mutation(internal.storage.ownership.registerObject, {
        key,
        userId,
      }))
    ) {
      throw new Error("account_storage_write_denied");
    }
  };

  /** Pins the source version once, so every page reads the same file. */
  const bindSourceVersion = async (job: WorkflowJob): Promise<string> => {
    if (job.sourceEtag) {
      return job.sourceEtag;
    }
    const head = await ops<{ etag?: string; exists: boolean; size?: number }>({
      op: "head-object",
      params: { key: job.sourceKey },
    });
    if (head.kind !== "ok" || !head.data.exists || !head.data.etag) {
      throw new Error("missing_source");
    }
    if (head.data.size !== job.fileSize) {
      throw new Error("source_changed");
    }
    return await convex.mutation(internal.import.sourceVersion.bind, {
      jobId,
      sourceEtag: head.data.etag,
    });
  };

  const readIndexPage = async (
    job: WorkflowJob,
    cursor: number,
    sourceEtag: string
  ): Promise<FilesImportIndexResult> => {
    const outcome = await ops<FilesImportIndexResult>({
      fallbackCodes: ["INVALID_INPUT"],
      op: "index-import-source",
      params: {
        cursor,
        expectedSize: job.fileSize,
        mode: job.mode,
        sourceEtag,
        sourceKey: job.sourceKey,
      },
    });
    if (outcome.kind === "ok") {
      return outcome.data;
    }
    if (outcome.code === "INVALID_INPUT") {
      throw new Error(
        /_count$/.test(outcome.message)
          ? IMPORT_FAILURE.TOO_MANY_ITEMS
          : IMPORT_FAILURE.INVALID_SOURCE
      );
    }
    throw new Error("import_source_unavailable");
  };

  const readMarkdown = async (
    job: WorkflowJob,
    sourceEtag: string,
    path: string
  ): Promise<FilesImportMarkdownResult> => {
    const outcome = await ops<FilesImportMarkdownResult>({
      op: "read-import-markdown",
      params: { path, sourceEtag, sourceKey: job.sourceKey },
    });
    if (outcome.kind !== "ok") {
      throw new Error("markdown_source_unavailable");
    }
    return outcome.data;
  };

  const storeItems = async (items: ImportIndexItem[]) => {
    for (let index = 0; index < items.length; index += IMPORT_INDEX_BATCH) {
      await convex.mutation(internal.dataImport.insertItems, {
        items: items.slice(index, index + IMPORT_INDEX_BATCH),
        jobId,
      });
    }
  };

  /** One page of the source into job items. */
  const indexPage = async (
    cursor: number
  ): Promise<Outcome<{ nextCursor?: number }>> => {
    const job = await loadJob();
    if (!job) {
      return { failureClass: "missing_job", ok: false };
    }
    try {
      const sourceEtag = await bindSourceVersion(job);
      const current = await loadJob();
      if (!current || current.cancelRequested) {
        return { ok: true };
      }
      const page = await readIndexPage(job, cursor, sourceEtag);
      assertImportCardCount(page.total, job.mode as ImportMode);
      if (page.sourceEtag !== sourceEtag) {
        throw new Error("source_changed");
      }
      const seen = new Set<string>();
      const normalized: ImportIndexItem[] = page.items.map((raw) => {
        if (raw.error) {
          return {
            content: (raw.label ?? `Item ${raw.sourceIndex + 1}`).slice(
              0,
              100_000
            ),
            failureCode:
              job.mode === "archive" ? "INVALID_ITEM" : "INVALID_BOOKMARK",
            failureReason: raw.error,
            sourceIndex: raw.sourceIndex,
            status: "failed" as const,
            type: "text" as const,
          };
        }
        const entries = new Map<string, { uncompressedSize: number }>();
        if (raw.file) {
          entries.set(raw.file.path, raw.file);
        }
        return normalizeIndexItem(raw.card, raw.sourceIndex, entries, seen);
      });
      const pending: ImportIndexItem[] = [];
      let pendingBytes = 0;
      for (
        let offset = 0;
        offset < normalized.length;
        offset += MARKDOWN_READS_AT_ONCE
      ) {
        const batch = normalized.slice(offset, offset + MARKDOWN_READS_AT_ONCE);
        // Markdown documents in a Teak archive become text cards.
        await Promise.all(
          batch.map(async (item) => {
            if (
              item.status === "pending" &&
              item.type === "document" &&
              item.filePath &&
              item.fileName &&
              isMarkdownFileName(item.fileName)
            ) {
              const markdown = await readMarkdown(
                job,
                sourceEtag,
                item.filePath
              );
              Object.assign(item, markdown);
              if ("type" in markdown && markdown.type === "text") {
                item.filePath = undefined;
                item.fileName = undefined;
                item.fileSize = undefined;
                item.mimeType = undefined;
              }
            }
          })
        );
        for (const item of batch) {
          const itemBytes = new TextEncoder().encode(
            JSON.stringify(item)
          ).byteLength;
          if (pending.length && pendingBytes + itemBytes > INSERT_BATCH_BYTES) {
            await storeItems(pending);
            pending.length = 0;
            pendingBytes = 0;
          }
          pending.push(item);
          pendingBytes += itemBytes;
        }
      }
      await storeItems(pending);
      if (page.nextCursor !== null && page.nextCursor <= cursor) {
        throw new Error("invalid_import_cursor");
      }
      return page.nextCursor === null
        ? { ok: true }
        : { nextCursor: page.nextCursor, ok: true };
    } catch (error) {
      if (isTransientError(error)) {
        throw error;
      }
      await reportBackgroundError(env, undefined, error, {
        stage: "index",
        task: "import",
      });
      return { failureClass: failureClassOf(error, "parse_failed"), ok: false };
    }
  };

  /** Copies the batch's archive files out of the ZIP, one object each. */
  const extractFiles = async (
    job: WorkflowJob,
    items: PendingItem[]
  ): Promise<Outcome> => {
    if (job.mode !== "archive") {
      return { failureClass: "missing_archive", ok: false };
    }
    const needed = new Map(
      items.map((item) => [item.filePath as string, item] as const)
    );
    try {
      const sourceEtag = await bindSourceVersion(job);
      const entries = [...needed.values()].map((item) => ({
        contentType: importStoredContentType(item),
        destinationKey: importFileKey(
          job.userKeyPrefix,
          jobId,
          item._id,
          item.fileName ?? "file"
        ),
        path: item.filePath as string,
      }));
      for (const entry of entries) {
        await ensureOwned(job.userId, entry.destinationKey);
      }
      const outcome = await ops<
        Array<{ destinationKey: string; path: string }>
      >({
        op: "extract-import-files",
        params: { archiveKey: job.sourceKey, entries, sourceEtag },
      });
      if (outcome.kind !== "ok") {
        throw new Error("file_extract_rejected");
      }
      for (const extracted of outcome.data) {
        const item = needed.get(extracted.path);
        if (!item) {
          throw new Error("unexpected_extracted_file");
        }
        await convex.mutation(internal.dataImport.setExtractedFile, {
          itemId: item._id,
          key: extracted.destinationKey,
        });
        needed.delete(extracted.path);
      }
      return needed.size
        ? { failureClass: "missing_file_entry", ok: false }
        : { ok: true };
    } catch (error) {
      if (isTransientError(error)) {
        throw error;
      }
      return {
        failureClass: failureClassOf(error, "file_extract_failed"),
        ok: false,
      };
    }
  };

  /** Creates cards for pending items, a few at a time, until time runs out. */
  const importBatches = async (): Promise<BatchOutcome> => {
    const startedAt = Date.now();
    for (;;) {
      const job = await loadJob();
      if (!job || job.cancelRequested) {
        return { kind: "canceled" };
      }
      const items: PendingItem[] = await convex.query(
        internal.dataImport.getPendingItems,
        { jobId, limit: IMPORT_CARD_BATCH }
      );
      if (!items.length) {
        return { kind: "done" };
      }
      const fileItems = items.filter(
        (item) => item.filePath && !item.extractedFileKey
      );
      const extracted = fileItems.length
        ? await extractFiles(job, fileItems)
        : ({ ok: true } as const);
      if (extracted.ok) {
        const result = await convex.mutation(
          internal.dataImport.createPendingBatch,
          { itemIds: items.map((item) => item._id), jobId }
        );
        if (result.failureClass) {
          return { failureClass: result.failureClass, kind: "failed" };
        }
        if (result.limitReached) {
          return {
            failureClass: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
            kind: "failed",
          };
        }
        if (result.retryAt) {
          return {
            delayMs: Math.max(1000, result.retryAt - Date.now()),
            kind: "sleep",
          };
        }
      } else {
        await convex.mutation(internal.dataImport.failItems, {
          code: "FILE_EXTRACT_FAILED",
          itemIds: fileItems.map((item) => item._id),
          jobId,
          reason: extracted.failureClass,
        });
      }
      if (!withinBudget(startedAt)) {
        return { kind: "more" };
      }
    }
  };

  /** Queues the source and unclaimed files for deletion; writes the report. */
  const finalizeObjects = async (): Promise<{ reportKey?: string }> => {
    const job = await loadJob();
    if (!job) {
      return {};
    }
    const keys = [job.sourceKey];
    let cursor: string | null = null;
    do {
      const files: { continueCursor: string; isDone: boolean; keys: string[] } =
        await convex.query(internal.dataImport.getUnclaimedFileKeysPage, {
          jobId,
          paginationOpts: { cursor, numItems: UNCLAIMED_PAGE_SIZE },
        });
      keys.push(...files.keys);
      cursor = files.isDone ? null : files.continueCursor;
    } while (cursor);
    await queueObjectDeletions(env, keys, ops);
    if (job.failedCount === 0) {
      return {};
    }
    const lines = [
      "Teak import report",
      `Created: ${job.createdCount}`,
      `Skipped: ${job.skippedCount}`,
      `Failed: ${job.failedCount}`,
      "",
    ];
    let reportCursor: string | null = null;
    do {
      const page: {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          content?: string;
          failureReason?: string;
          fileName?: string;
          sourceIndex: number;
        }>;
      } = await convex.query(internal.dataImport.getFailureReportRows, {
        cursor: reportCursor,
        jobId,
        limit: REPORT_PAGE_SIZE,
      });
      for (const item of page.page) {
        lines.push(
          `${item.sourceIndex + 1}. ${reportLabel(item.content || item.fileName || "Item")}: ${reportLabel(item.failureReason ?? "Import failed")}`
        );
      }
      reportCursor = page.isDone ? null : page.continueCursor;
    } while (reportCursor);
    const reportKey = importReportKey(job.userKeyPrefix, jobId);
    await ensureOwned(job.userId, reportKey);
    await gatedEnv(env).BUCKET.put(reportKey, lines.join("\n"), {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
    return { reportKey };
  };

  let settled = false;
  const finalize = async (
    status: ImportOutcome,
    failureClass?: string
  ): Promise<{ status: ImportOutcome }> => {
    let reportKey: string | undefined;
    let finalFailureClass = failureClass;
    try {
      ({ reportKey } = await step.do(
        "finalize import objects",
        FINALIZE_STEP,
        finalizeObjects
      ));
    } catch (error) {
      console.error("[workflows/import] finalization failed", {
        error: errorMessage(error),
        jobId,
      });
      finalFailureClass = failureClass ?? "import_finalization_failed";
    }
    await step.do("finish job", CONVEX_STEP, () =>
      settleConvexErrors(async () => {
        await convex.mutation(internal.dataImport.finishJob, {
          jobId,
          status,
          ...(reportKey ? { reportKey } : {}),
          ...(finalFailureClass ? { failureClass: finalFailureClass } : {}),
        });
        return null;
      })
    );
    settled = true;
    return { status };
  };

  const setPhase = (status: "importing" | "parsing", phase: string) =>
    step.do(`set ${status} phase`, CONVEX_STEP, () =>
      settleConvexErrors(() =>
        convex.mutation(internal.dataImport.setPhase, { jobId, phase, status })
      )
    );

  const body = async (): Promise<{ status: ImportOutcome }> => {
    const job = await step.do("load job", CONVEX_STEP, loadJob);
    if (!job) {
      return stopRun("import_job_missing");
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      settled = true;
      return { status: job.status as ImportOutcome };
    }
    // A job already importing finished indexing; a restarted run goes on
    // from its pending items.
    if (job.status !== "importing") {
      if ((await setPhase("parsing", "Parsing import file")).canceled) {
        return finalize("canceled");
      }
      let cursor = 0;
      for (let page = 1; ; page += 1) {
        const indexed = await step.do(`index page ${page}`, IMPORT_STEP, () =>
          indexPage(cursor)
        );
        if (!indexed.ok) {
          return finalize("failed", indexed.failureClass);
        }
        if (indexed.nextCursor === undefined) {
          break;
        }
        cursor = indexed.nextCursor;
      }
      if ((await setPhase("importing", "Importing cards")).canceled) {
        return finalize("canceled");
      }
    }
    for (let round = 1; ; round += 1) {
      const outcome = await step.do(
        `import cards ${round}`,
        IMPORT_STEP,
        importBatches
      );
      switch (outcome.kind) {
        case "canceled":
          return finalize("canceled");
        case "done":
          return finalize("completed");
        case "failed":
          return finalize("failed", outcome.failureClass);
        case "sleep":
          await step.sleep(`card rate limit ${round}`, outcome.delayMs);
          break;
        default:
          break;
      }
    }
  };

  return runReported(
    run,
    async () => {
      try {
        return await body();
      } catch (error) {
        // A job never stays active: finish it here, and the completion
        // report finishes it again if this cannot.
        if (!settled) {
          await finalize("failed", "import_workflow_failed").catch(
            (finishError) => {
              console.error("[workflows/import] could not finish the job", {
                error: errorMessage(finishError),
                jobId,
              });
            }
          );
        }
        throw error;
      }
    },
    convex
  );
};
