import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  IMPORT_CARD_BATCH,
  IMPORT_INDEX_BATCH,
  type ImportMode,
} from "@teak/convex/import/constants";
import {
  type ImportIndexItem,
  importFileKey,
  importReportKey,
  importStagedPartKey,
  importStagedPartKeys,
  importStoredContentType,
  normalizeIndexItem,
} from "@teak/convex/import/indexItems";
import { assertImportCardCount } from "@teak/convex/import/validate";
import { CARD_ERROR_MESSAGES } from "@teak/convex/shared/constants";
import { isMarkdownFileName } from "@teak/convex/shared/markdown";
import { urlKey } from "@teak/convex/shared/utils/urlKey";
import type {
  FilesImportIndexResult,
  FilesImportMarkdownResult,
} from "@teak/files-protocol";
import type { FunctionReturnType } from "convex/server";
import { importIndexFailureClass } from "../archives/importSource";
import { sha256Hex } from "../lib";
import { queueObjectDeletions } from "../queues/objectDeletions";
import { reportBackgroundError } from "../telemetry";
import {
  isTransientError,
  resolveDeps,
  settleConvexErrors,
  type WorkflowDeps,
  withinBudget,
} from "./deps";
import { gatedEnv, isRetryableFilesError } from "./filesOps";
import {
  CONVEX_STEP,
  errorMessage,
  retryConfig,
  runReported,
  type StepConfig,
  type StepContext,
  stopRun,
  type WorkflowRun,
} from "./runtime";

export interface ImportParams {
  jobId: string;
}

export type ImportOutcome = "canceled" | "completed" | "failed";

type WorkflowJob = NonNullable<
  FunctionReturnType<typeof internal.dataImport.getWorkflowJob>
>;
type StagedState = NonNullable<WorkflowJob["stagedItems"]>;

/** An item read from the source that is waiting to become a card. */
export type StagedItem = Omit<
  Extract<ImportIndexItem, { status: "pending" }>,
  "status"
>;

interface PendingItem {
  _id: Id<"importJobItems">;
  extractedFileKey?: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
}

interface ExtractEntry {
  contentType: string;
  destinationKey: string;
  path: string;
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

const IMPORT_RETRY_LIMIT = 5;
const IMPORT_STEP: StepConfig = {
  retries: {
    backoff: "exponential",
    delay: "10 seconds",
    limit: IMPORT_RETRY_LIMIT,
  },
  timeout: "10 minutes",
};
const FINALIZE_STEP = retryConfig(3, 500);
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);
const INSERT_BATCH_BYTES = 2 * 1024 * 1024;
/** Staged items are written to R2 in objects of about this size. */
export const STAGED_PART_BYTES = 8 * 1024 * 1024;
const MARKDOWN_READS_AT_ONCE = 8;
const REPORT_PAGE_SIZE = 200;
const UNCLAIMED_PAGE_SIZE = 200;
const encoder = new TextEncoder();

const reportLabel = (text: string) =>
  text.length > 1024 ? `${text.slice(0, 1024)}…` : text;

const failureClassOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.slice(0, 160) : fallback;

const jsonBytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).byteLength;

/** Splits items into runs of at most `maxBytes` of JSON (and `maxItems`). */
const chunkByBytes = <T>(
  items: T[],
  maxBytes: number,
  maxItems = Number.POSITIVE_INFINITY
): T[][] => {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = jsonBytes(item);
    if (
      current.length &&
      (bytes + size > maxBytes || current.length >= maxItems)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
};

/**
 * Cross-page duplicate links are tracked by a short hash of their URL key
 * (`normalizeIndexItem` fills `seen` with keys), not the URL itself.
 */
const seenHash = async (key: string) => (await sha256Hex(key)).slice(0, 32);
const linkSeenHash = (url: string) => seenHash(urlKey(url) ?? url);

const withoutStatus = <T extends { status: string }>({
  status: _status,
  ...rest
}: T): Omit<T, "status"> => rest;

export const runImport = (
  run: WorkflowRun<ImportParams>,
  deps: WorkflowDeps = {}
): Promise<{ status: ImportOutcome }> => {
  const { convex, ops } = resolveDeps(run, deps);
  const { env, step } = run;
  const jobId = run.params.jobId as Id<"importJobs">;
  const bucket = () => gatedEnv(env).BUCKET;

  const loadJob = () =>
    convex.query(internal.dataImport.getWorkflowJob, { jobId });

  // A Files op that says a retry can clear it (an R2 hiccup) retries the
  // step; on its last attempt it fails the page or batch, as any other error.
  let lastAttempt = false;
  const importStep =
    <T>(run: () => Promise<T>) =>
    (ctx: StepContext): Promise<T> => {
      lastAttempt = ctx.attempt > IMPORT_RETRY_LIMIT;
      return run();
    };
  const shouldRetry = (error: unknown) =>
    isTransientError(error) || (isRetryableFilesError(error) && !lastAttempt);

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
      throw new Error(importIndexFailureClass(outcome.message));
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

  /**
   * Reads one source page as import items. `seen` holds the URLs of the
   * page's items that were importable before any Markdown was read: a later
   * item with one of them is a duplicate.
   */
  const readPage = async (
    job: WorkflowJob,
    sourceEtag: string,
    cursor: number,
    { markdown = true } = {}
  ) => {
    const page = await readIndexPage(job, cursor, sourceEtag);
    assertImportCardCount(page.total, job.mode as ImportMode);
    if (page.sourceEtag !== sourceEtag) {
      throw new Error("source_changed");
    }
    if (page.nextCursor !== null && page.nextCursor <= cursor) {
      throw new Error("invalid_import_cursor");
    }
    const seen = new Set<string>();
    const items: ImportIndexItem[] = page.items.map((raw) => {
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
    for (
      let offset = 0;
      markdown && offset < items.length;
      offset += MARKDOWN_READS_AT_ONCE
    ) {
      await Promise.all(
        items
          .slice(offset, offset + MARKDOWN_READS_AT_ONCE)
          .map(async (item) => {
            if (
              item.status === "pending" &&
              item.type === "document" &&
              item.filePath &&
              item.fileName &&
              isMarkdownFileName(item.fileName)
            ) {
              const read = await readMarkdown(job, sourceEtag, item.filePath);
              Object.assign(item, read);
              if ("type" in read && read.type === "text") {
                item.filePath = undefined;
                item.fileName = undefined;
                item.fileSize = undefined;
                item.mimeType = undefined;
              }
            }
          })
      );
    }
    return { items, nextCursor: page.nextCursor, seen };
  };

  /** Runs `read` for a page, turning a non-transient error into a failure. */
  const indexing = async <T>(
    read: () => Promise<Outcome<T>>
  ): Promise<Outcome<T>> => {
    try {
      return await read();
    } catch (error) {
      if (shouldRetry(error)) {
        throw error;
      }
      await reportBackgroundError(env, undefined, error, {
        stage: "index",
        task: "import",
      });
      return { failureClass: failureClassOf(error, "parse_failed"), ok: false };
    }
  };

  const storeItems = async (items: ImportIndexItem[]) => {
    for (let index = 0; index < items.length; index += IMPORT_INDEX_BATCH) {
      await convex.mutation(internal.dataImport.insertItems, {
        items: items.slice(index, index + IMPORT_INDEX_BATCH),
        jobId,
      });
    }
  };

  /** Legacy staging: a job queued before `stagedItems` stores rows. */
  const indexPage = async (
    cursor: number
  ): Promise<Outcome<{ nextCursor?: number }>> => {
    const job = await loadJob();
    if (!job) {
      return { failureClass: "missing_job", ok: false };
    }
    return await indexing<{ nextCursor?: number }>(async () => {
      const sourceEtag = await bindSourceVersion(job);
      const current = await loadJob();
      if (!current || current.cancelRequested) {
        return { ok: true };
      }
      const page = await readPage(job, sourceEtag, cursor);
      for (const chunk of chunkByBytes(page.items, INSERT_BATCH_BYTES)) {
        await storeItems(chunk);
      }
      return page.nextCursor === null
        ? { ok: true }
        : { nextCursor: page.nextCursor, ok: true };
    });
  };

  /**
   * Indexes source page `page` into staged R2 parts. Convex records the
   * page's counts and its failed items, and the number of parts, before the
   * parts are written; a retry after that writes the same parts again.
   */
  const indexStagedPage = async (
    page: number,
    cursor: number,
    seenBefore: ReadonlySet<string>
  ): Promise<Outcome<{ nextCursor?: number; urls: string[] }>> => {
    const job = await loadJob();
    if (!job?.stagedItems) {
      return { failureClass: "missing_job", ok: false };
    }
    const staged = job.stagedItems;
    let parts: StagedItem[][] = [];
    let firstPart = 0;
    const indexed = await indexing<{ nextCursor?: number; urls: string[] }>(
      async () => {
        const sourceEtag = await bindSourceVersion(job);
        const current = await loadJob();
        if (!current || current.cancelRequested) {
          return { ok: true, urls: [] };
        }
        if (staged.pages !== page && staged.pages !== page - 1) {
          throw new Error("staged_page_out_of_order");
        }
        const read = await readPage(job, sourceEtag, cursor);
        const urls = await Promise.all([...read.seen].map(seenHash));
        const pending: StagedItem[] = [];
        const failed: ImportIndexItem[] = [];
        let skipped = 0;
        for (const item of read.items) {
          if (
            item.status === "pending" &&
            item.url &&
            seenBefore.has(await linkSeenHash(item.url))
          ) {
            Object.assign(item, {
              failureCode: "SOURCE_DUPLICATE",
              failureReason: "Duplicate URL in import file",
              status: "skipped",
            });
          }
          if (item.status === "pending") {
            pending.push(withoutStatus(item));
          } else if (item.status === "failed") {
            failed.push(item);
          } else {
            skipped += 1;
          }
        }
        parts = chunkByBytes(pending, STAGED_PART_BYTES);
        firstPart =
          staged.pages === page
            ? staged.parts - parts.length + 1
            : staged.parts + 1;
        for (const chunk of chunkByBytes(
          failed,
          INSERT_BATCH_BYTES,
          IMPORT_INDEX_BATCH
        )) {
          await convex.mutation(internal.import.staging.recordFailures, {
            items: chunk.map((item) => ({
              ...withoutStatus(item),
              failureCode: item.failureCode ?? "INVALID_ITEM",
              failureReason: item.failureReason ?? "Import failed",
            })),
            jobId,
          });
        }
        await convex.mutation(internal.import.staging.recordPage, {
          cursor,
          failed: failed.length,
          jobId,
          nextCursor: read.nextCursor,
          page,
          parsed: read.items.length,
          parts: parts.length,
          skipped,
        });
        return read.nextCursor === null
          ? { ok: true, urls }
          : { nextCursor: read.nextCursor, ok: true, urls };
      }
    );
    // Outside `indexing`, so a failed write is retried rather than failing
    // the import.
    for (const [index, items] of (indexed.ok ? parts : []).entries()) {
      await bucket().put(
        importStagedPartKey(job.userKeyPrefix, jobId, firstPart + index),
        JSON.stringify({ items }),
        { httpMetadata: { contentType: "application/json" } }
      );
    }
    return indexed;
  };

  /**
   * A new run of a job that was indexing: rebuilds the URLs of the pages
   * before the last recorded one, and finds where that page starts, so it
   * can be staged again in case its parts were never written.
   */
  const resumeStagedIndex = (
    pages: number
  ): Promise<Outcome<{ cursor: number; urls: string[] }>> =>
    indexing<{ cursor: number; urls: string[] }>(async () => {
      const job = await loadJob();
      if (!job) {
        return { failureClass: "missing_job", ok: false };
      }
      const sourceEtag = await bindSourceVersion(job);
      const urls: string[] = [];
      let cursor = 0;
      for (let page = 1; page < pages; page += 1) {
        const read = await readPage(job, sourceEtag, cursor, {
          markdown: false,
        });
        if (read.nextCursor === null) {
          throw new Error("invalid_import_cursor");
        }
        urls.push(...(await Promise.all([...read.seen].map(seenHash))));
        cursor = read.nextCursor;
      }
      return { cursor, ok: true, urls };
    });

  const extractFiles = async (
    job: WorkflowJob,
    entries: ExtractEntry[],
    onExtracted: (entry: ExtractEntry) => Promise<void> = () =>
      Promise.resolve()
  ): Promise<Outcome> => {
    if (job.mode !== "archive") {
      return { failureClass: "missing_archive", ok: false };
    }
    const needed = new Map(
      entries.map((entry) => [entry.destinationKey, entry] as const)
    );
    try {
      const sourceEtag = await bindSourceVersion(job);
      for (const entry of needed.values()) {
        await ensureOwned(job.userId, entry.destinationKey);
      }
      const outcome = await ops<
        Array<{ destinationKey: string; path: string }>
      >({
        op: "extract-import-files",
        params: {
          archiveKey: job.sourceKey,
          entries: [...needed.values()],
          sourceEtag,
        },
      });
      if (outcome.kind !== "ok") {
        throw new Error("file_extract_rejected");
      }
      for (const extracted of outcome.data) {
        const entry = needed.get(extracted.destinationKey);
        if (!entry) {
          throw new Error("unexpected_extracted_file");
        }
        await onExtracted(entry);
        needed.delete(extracted.destinationKey);
      }
      return needed.size
        ? { failureClass: "missing_file_entry", ok: false }
        : { ok: true };
    } catch (error) {
      if (shouldRetry(error)) {
        throw error;
      }
      return {
        failureClass: failureClassOf(error, "file_extract_failed"),
        ok: false,
      };
    }
  };

  const batchOutcome = (result: {
    failureClass?: string;
    limitReached: boolean;
    retryAt?: number;
  }): BatchOutcome | null => {
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
    return null;
  };

  /** Legacy staging: a job queued before `stagedItems` reads its rows. */
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
      const byKey = new Map(
        fileItems.map((item) => [
          importFileKey(
            job.userKeyPrefix,
            jobId,
            item._id,
            item.fileName ?? "file"
          ),
          item,
        ])
      );
      const extracted = fileItems.length
        ? await extractFiles(
            job,
            [...byKey].map(([destinationKey, item]) => ({
              contentType: importStoredContentType(item),
              destinationKey,
              path: item.filePath as string,
            })),
            async ({ destinationKey }) => {
              await convex.mutation(internal.dataImport.setExtractedFile, {
                itemId: (byKey.get(destinationKey) as PendingItem)._id,
                key: destinationKey,
              });
            }
          )
        : ({ ok: true } as const);
      if (extracted.ok) {
        const ended = batchOutcome(
          await convex.mutation(internal.dataImport.createPendingBatch, {
            itemIds: items.map((item) => item._id),
            jobId,
          })
        );
        if (ended) {
          return ended;
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

  const stagedFileKey = (job: WorkflowJob, item: StagedItem) =>
    importFileKey(
      job.userKeyPrefix,
      jobId,
      `item-${String(item.sourceIndex)}`,
      item.fileName ?? "file"
    );

  /** Reads staged parts, keeping the last one read. */
  const stagedPartReader = (job: WorkflowJob) => {
    let cached: { items: StagedItem[]; part: number } | undefined;
    return async (part: number): Promise<StagedItem[]> => {
      if (cached?.part !== part) {
        const object = await bucket().get(
          importStagedPartKey(job.userKeyPrefix, jobId, part)
        );
        if (!object) {
          throw new Error("staged_part_missing");
        }
        cached = {
          items: ((await object.json()) as { items: StagedItem[] }).items,
          part,
        };
      }
      return cached.items;
    };
  };

  /** The next items to create, from the job's position, within one part. */
  const nextStagedBatch = async (
    staged: StagedState,
    readPart: (part: number) => Promise<StagedItem[]>
  ) => {
    for (
      let { part, offset } = staged;
      part <= staged.parts;
      part += 1, offset = 0
    ) {
      const items = await readPart(part);
      if (offset < items.length) {
        return {
          items: items.slice(offset, offset + IMPORT_CARD_BATCH),
          offset,
          part,
        };
      }
    }
    return null;
  };

  const importStagedBatches = async (): Promise<BatchOutcome> => {
    const startedAt = Date.now();
    let readPart: ((part: number) => Promise<StagedItem[]>) | undefined;
    for (;;) {
      const job = await loadJob();
      if (!job?.stagedItems || job.cancelRequested) {
        return { kind: "canceled" };
      }
      readPart ??= stagedPartReader(job);
      const batch = await nextStagedBatch(job.stagedItems, readPart);
      if (!batch) {
        return { kind: "done" };
      }
      const fileItems = batch.items.filter((item) => item.filePath);
      const extracted = fileItems.length
        ? await extractFiles(
            job,
            fileItems.map((item) => ({
              contentType: importStoredContentType(item),
              destinationKey: stagedFileKey(job, item),
              path: item.filePath as string,
            }))
          )
        : ({ ok: true } as const);
      const items = batch.items.map((item) => {
        if (!item.filePath) {
          return item;
        }
        const withFile = {
          ...item,
          extractedFileKey: stagedFileKey(job, item),
        };
        return extracted.ok
          ? withFile
          : {
              ...withFile,
              failureCode: "FILE_EXTRACT_FAILED",
              failureReason: extracted.failureClass,
            };
      });
      const ended = batchOutcome(
        await convex.mutation(internal.import.staging.createBatch, {
          from: {
            offset: job.stagedItems.offset,
            part: job.stagedItems.part,
          },
          items,
          jobId,
          offset: batch.offset,
          part: batch.part,
        })
      );
      if (ended) {
        return ended;
      }
      if (!withinBudget(startedAt)) {
        return { kind: "more" };
      }
    }
  };

  /** Files extracted for the batch at the job's position, never created. */
  const unclaimedStagedFiles = async (job: WorkflowJob): Promise<string[]> => {
    if (!job.stagedItems) {
      return [];
    }
    try {
      const batch = await nextStagedBatch(
        job.stagedItems,
        stagedPartReader(job)
      );
      return (batch?.items ?? []).flatMap((item) =>
        item.filePath ? [stagedFileKey(job, item)] : []
      );
    } catch {
      // A finalize retried after its parts were deleted.
      return [];
    }
  };

  const finalizeObjects = async (): Promise<{ reportKey?: string }> => {
    const job = await loadJob();
    if (!job) {
      return {};
    }
    const keys = [job.sourceKey];
    if (job.stagedItems) {
      keys.push(
        ...(await unclaimedStagedFiles(job)),
        ...importStagedPartKeys(job.userKeyPrefix, jobId, job.stagedItems)
      );
    } else {
      let cursor: string | null = null;
      do {
        const files: {
          continueCursor: string;
          isDone: boolean;
          keys: string[];
        } = await convex.query(internal.dataImport.getUnclaimedFileKeysPage, {
          jobId,
          paginationOpts: { cursor, numItems: UNCLAIMED_PAGE_SIZE },
        });
        keys.push(...files.keys);
        cursor = files.isDone ? null : files.continueCursor;
      } while (cursor);
    }
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
    await bucket().put(reportKey, lines.join("\n"), {
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

  /** Indexes the source; returns the finished run when indexing failed. */
  const indexSource = async (
    staged: StagedState | undefined
  ): Promise<{ status: ImportOutcome } | null> => {
    if (!staged) {
      let cursor = 0;
      for (let page = 1; ; page += 1) {
        const indexed = await step.do(
          `index page ${page}`,
          IMPORT_STEP,
          importStep(() => indexPage(cursor))
        );
        if (!indexed.ok) {
          return finalize("failed", indexed.failureClass);
        }
        if (indexed.nextCursor === undefined) {
          return null;
        }
        cursor = indexed.nextCursor;
      }
    }
    let page = staged.pages;
    let cursor = staged.cursor ?? 0;
    const seen = new Set<string>();
    if (page > 0) {
      const resumed = await step.do(
        "resume staged index",
        IMPORT_STEP,
        importStep(() => resumeStagedIndex(page))
      );
      if (!resumed.ok) {
        return finalize("failed", resumed.failureClass);
      }
      for (const url of resumed.urls) {
        seen.add(url);
      }
      cursor = resumed.cursor;
      page -= 1;
    }
    for (;;) {
      page += 1;
      const pageNumber = page;
      const pageCursor = cursor;
      const indexed = await step.do(
        `index page ${pageNumber}`,
        IMPORT_STEP,
        importStep(() => indexStagedPage(pageNumber, pageCursor, seen))
      );
      if (!indexed.ok) {
        return finalize("failed", indexed.failureClass);
      }
      for (const url of indexed.urls) {
        seen.add(url);
      }
      if (indexed.nextCursor === undefined) {
        return null;
      }
      cursor = indexed.nextCursor;
    }
  };

  const body = async (): Promise<{ status: ImportOutcome }> => {
    const job = await step.do("load job", CONVEX_STEP, loadJob);
    if (!job) {
      return stopRun("import_job_missing");
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      settled = true;
      return { status: job.status as ImportOutcome };
    }
    if (job.status !== "importing") {
      if ((await setPhase("parsing", "Parsing import file")).canceled) {
        return finalize("canceled");
      }
      const failed = await indexSource(job.stagedItems);
      if (failed) {
        return failed;
      }
      if ((await setPhase("importing", "Importing cards")).canceled) {
        return finalize("canceled");
      }
    }
    for (let round = 1; ; round += 1) {
      const outcome = await step.do(
        `import cards ${round}`,
        IMPORT_STEP,
        importStep(job.stagedItems ? importStagedBatches : importBatches)
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
