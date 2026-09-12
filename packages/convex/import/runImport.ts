"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { inferFileFormat } from "../shared/fileFormats";
import { isMarkdownFileName } from "../shared/markdown";
import { TELEMETRY_OPERATIONS } from "../shared/telemetry";
import {
  callFilesWorkerJson,
  type FilesWorkerHeadObjectResult,
  isFilesWorkerConfigured,
  putObjectViaFilesWorker,
} from "../storage/filesWorkerClient";
import { assertR2KeyInNamespace, buildR2UserPrefix } from "../storage/r2";
import {
  recordBackendHandledFailure,
  withBackendSpan,
} from "../telemetry/sentry";
import { readImportIndexPage, readLegacyMarkdown } from "./archiveZip";
import {
  IMPORT_INDEX_BATCH,
  type ImportMode,
  MAX_IMPORT_FILE_BYTES,
} from "./constants";
import { assertImportCardCount, validateImportCard } from "./validate";

const internalAny = internal as Record<string, any>;

const observeImport =
  <TArgs, TResult>(
    name: string,
    handler: (ctx: ActionCtx, args: TArgs) => Promise<TResult>
  ) =>
  (ctx: ActionCtx, args: TArgs): Promise<TResult> =>
    withBackendSpan(
      {
        name,
        operation: TELEMETRY_OPERATIONS.import,
        stage: "import",
        surface: "backend",
        workflowId:
          args &&
          typeof args === "object" &&
          "jobId" in args &&
          typeof args.jobId === "string"
            ? args.jobId
            : undefined,
      },
      () => handler(ctx, args)
    );

function normalizeIndexItem(
  raw: unknown,
  sourceIndex: number,
  entries: Map<string, { uncompressedSize: number }>,
  seenUrls: Set<string>
) {
  try {
    const card = validateImportCard(raw);
    if (card.url && seenUrls.has(card.url)) {
      return {
        sourceIndex,
        status: "skipped" as const,
        type: card.type,
        content: card.content,
        url: card.url,
        failureCode: "SOURCE_DUPLICATE",
        failureReason: "Duplicate URL in import file",
      };
    }
    if (card.url) {
      seenUrls.add(card.url);
    }
    if (card.file) {
      const entry = entries.get(card.file.path);
      if (!entry) {
        throw new Error(`Missing ZIP entry: ${card.file.path}`);
      }
      if (entry.uncompressedSize > MAX_IMPORT_FILE_BYTES) {
        throw new Error("File exceeds the 20 MiB limit");
      }
      if (
        card.file.fileSize !== undefined &&
        card.file.fileSize !== entry.uncompressedSize
      ) {
        throw new Error("File size does not match the archive entry");
      }
    }
    return {
      sourceIndex,
      status: "pending" as const,
      type: card.type,
      content: card.content,
      url: card.url,
      tags: card.tags,
      notes: card.notes,
      isFavorited: card.isFavorited,
      colors: card.colors,
      importedCreatedAt: card.createdAt,
      filePath: card.file?.path,
      fileName: card.file?.fileName,
      fileSize: card.file
        ? entries.get(card.file.path)?.uncompressedSize
        : undefined,
      mimeType: card.file?.mimeType,
      duration: card.file?.duration,
      width: card.file?.width,
      height: card.file?.height,
    };
  } catch (error) {
    const value = raw as Record<string, unknown> | null;
    return {
      sourceIndex,
      status: "failed" as const,
      type: "text" as const,
      content:
        typeof value?.content === "string"
          ? value.content.slice(0, 100_000)
          : `Item ${sourceIndex + 1}`,
      failureCode: "INVALID_ITEM",
      failureReason:
        error instanceof Error ? error.message : "Invalid import item",
    };
  }
}

async function storeItems(
  ctx: ActionCtx,
  jobId: string,
  items: ReturnType<typeof normalizeIndexItem>[]
) {
  for (let index = 0; index < items.length; index += IMPORT_INDEX_BATCH) {
    await ctx.runMutation(internalAny.dataImport.insertItems, {
      jobId,
      items: items.slice(index, index + IMPORT_INDEX_BATCH),
    });
  }
}

async function bindSourceVersion(
  ctx: ActionCtx,
  job: { _id: string; sourceKey: string; sourceEtag?: string; fileSize: number }
) {
  if (job.sourceEtag) {
    return job.sourceEtag;
  }
  assertR2KeyInNamespace(job.sourceKey);
  const outcome = await callFilesWorkerJson<FilesWorkerHeadObjectResult>({
    op: "head-object",
    params: { key: job.sourceKey },
  });
  if (outcome.kind !== "ok" || !outcome.data.exists || !outcome.data.etag) {
    throw new Error("missing_source");
  }
  if (outcome.data.size !== job.fileSize) {
    throw new Error("source_changed");
  }
  return ctx.runMutation(internalAny["import/sourceVersion"].bind, {
    jobId: job._id,
    sourceEtag: outcome.data.etag,
  });
}

export const indexImportSource = internalAction({
  args: { jobId: v.id("importJobs"), cursor: v.optional(v.number()) },
  returns: v.object({
    ok: v.boolean(),
    failureClass: v.optional(v.string()),
    nextCursor: v.optional(v.number()),
  }),
  handler: observeImport(
    "import.index",
    async (ctx, { jobId, cursor = 0 }: { jobId: string; cursor?: number }) => {
      const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
      if (!job) {
        return { ok: false, failureClass: "missing_job" };
      }
      try {
        const seen = new Set<string>();
        const sourceEtag = await bindSourceVersion(ctx, job);
        const current = await ctx.runQuery(internalAny.dataImport.getJob, {
          jobId,
        });
        if (!current || current.cancelRequested) {
          return { ok: true };
        }
        const page = await readImportIndexPage({
          sourceKey: job.sourceKey,
          expectedSize: job.fileSize,
          mode: job.mode as ImportMode,
          cursor,
          sourceEtag,
        });
        assertImportCardCount(page.total, job.mode as ImportMode);
        if (page.sourceEtag !== sourceEtag) {
          throw new Error("source_changed");
        }
        const normalized = page.items.map((raw) => {
          if (raw.error) {
            const failed = {
              sourceIndex: raw.sourceIndex,
              status: "failed" as const,
              type: "text" as const,
              content: (raw.label ?? `Item ${raw.sourceIndex + 1}`).slice(
                0,
                100_000
              ),
              failureCode:
                job.mode === "archive" ? "INVALID_ITEM" : "INVALID_BOOKMARK",
              failureReason: raw.error,
            };
            return failed;
          }
          const entries = new Map<string, { uncompressedSize: number }>();
          if (raw.file) {
            entries.set(raw.file.path, raw.file);
          }
          return normalizeIndexItem(raw.card, raw.sourceIndex, entries, seen);
        });
        const items: ReturnType<typeof normalizeIndexItem>[] = [];
        let batchBytes = 0;
        // Bound both concurrent remote reads and expanded Markdown memory.
        for (let offset = 0; offset < normalized.length; offset += 8) {
          const batch = normalized.slice(offset, offset + 8);
          await Promise.all(
            batch.map(async (item) => {
              if (
                item.status === "pending" &&
                item.type === "document" &&
                item.filePath &&
                item.fileName &&
                isMarkdownFileName(item.fileName)
              ) {
                Object.assign(
                  item,
                  await readLegacyMarkdown(
                    job.sourceKey,
                    sourceEtag,
                    item.filePath
                  )
                );
              }
            })
          );
          for (const item of batch) {
            const itemBytes = new TextEncoder().encode(
              JSON.stringify(item)
            ).byteLength;
            if (items.length && batchBytes + itemBytes > 4 * 1024 * 1024) {
              await storeItems(ctx, jobId, items);
              items.length = 0;
              batchBytes = 0;
            }
            items.push(item);
            batchBytes += itemBytes;
          }
        }
        await storeItems(ctx, jobId, items);
        if (page.nextCursor !== null && page.nextCursor <= cursor) {
          throw new Error("invalid_import_cursor");
        }
        return page.nextCursor === null
          ? { ok: true }
          : { ok: true, nextCursor: page.nextCursor };
      } catch (error) {
        recordBackendHandledFailure(error, {
          operation: TELEMETRY_OPERATIONS.import,
          stage: "import",
        });
        return {
          ok: false,
          failureClass:
            error instanceof Error
              ? error.message.slice(0, 160)
              : "parse_failed",
        };
      }
    }
  ),
});

function deterministicFileKey(
  userId: string,
  jobId: string,
  itemId: string,
  fileName: string
) {
  const safe =
    fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) || "file";
  return `${buildR2UserPrefix(userId)}/import-${jobId}/${itemId}/file/${safe}`;
}

const ACTIVE_IMPORT_FORMATS = new Set(["html", "svg"]);

export const importStoredContentType = (item: {
  fileName?: string | null;
  mimeType?: string | null;
}): string => {
  const format = inferFileFormat({
    fileName: item.fileName ?? "file",
    mimeType: item.mimeType,
  });
  if (!format) {
    return "application/octet-stream";
  }
  return ACTIVE_IMPORT_FORMATS.has(format.id)
    ? "text/plain; charset=utf-8"
    : format.mimeType;
};

export const extractImportFiles = internalAction({
  args: {
    jobId: v.id("importJobs"),
    itemIds: v.array(v.id("importJobItems")),
  },
  returns: v.object({ ok: v.boolean(), failureClass: v.optional(v.string()) }),
  handler: observeImport(
    "import.extract_files",
    async (ctx, { jobId, itemIds }: { jobId: string; itemIds: string[] }) => {
      const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
      if (job?.mode !== "archive") {
        return { ok: false, failureClass: "missing_archive" };
      }
      const items = await ctx.runQuery(internalAny.dataImport.getItemsByIds, {
        jobId,
        itemIds,
      });
      const needed = new Map<string, any>(
        items
          .filter((item: any) => item.filePath && !item.extractedFileKey)
          .map((item: any) => [item.filePath, item] as [string, any])
      );
      if (!needed.size) {
        return { ok: true };
      }
      try {
        if (!isFilesWorkerConfigured()) {
          throw new Error("files_worker_not_configured");
        }
        const sourceEtag = await bindSourceVersion(ctx, job);
        const entries = [...needed.values()].map((item) => ({
          contentType: importStoredContentType(item),
          destinationKey: deterministicFileKey(
            job.userId,
            jobId,
            item._id,
            item.fileName ?? "file"
          ),
          path: item.filePath,
        }));
        const outcome = await callFilesWorkerJson<
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
          await ctx.runMutation(internalAny.dataImport.setExtractedFile, {
            itemId: item._id,
            key: extracted.destinationKey,
          });
          needed.delete(extracted.path);
        }
        return needed.size
          ? { ok: false, failureClass: "missing_file_entry" }
          : { ok: true };
      } catch (error) {
        return {
          ok: false,
          failureClass:
            error instanceof Error
              ? error.message.slice(0, 160)
              : "file_extract_failed",
        };
      }
    }
  ),
});

// Failure reports contain a bounded identifying excerpt, never entire card bodies.
const reportLabel = (text: string) =>
  text.length > 1024 ? `${text.slice(0, 1024)}…` : text;

async function abortImportUpload(key: string, uploadId?: string) {
  if (!uploadId) {
    return;
  }
  assertR2KeyInNamespace(key);
  const result = await callFilesWorkerJson({
    op: "abort-multipart",
    params: { key, uploadId },
  });
  if (result.kind !== "ok") {
    throw new Error("import_upload_abort_unavailable");
  }
}

async function queueImportObjectDeletion(
  ctx: ActionCtx,
  keys: Array<string | undefined>
) {
  await ctx.runMutation(
    internalAny["workflows/objectCleanup"].startObjectDeletion,
    {
      keys: keys.filter((key): key is string => Boolean(key)),
    }
  );
}

export const finalizeImportObjects = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ reportKey: v.optional(v.string()) }),
  handler: observeImport(
    "import.finalize",
    async (ctx, { jobId }: { jobId: string }) => {
      const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
      if (!job) {
        return {};
      }
      let reportKey: string | undefined;
      if (job.failedCount > 0) {
        const lines = [
          "Teak import report",
          `Created: ${job.createdCount}`,
          `Skipped: ${job.skippedCount}`,
          `Failed: ${job.failedCount}`,
          "",
        ];
        let cursor: string | null = null;
        do {
          const page: any = await ctx.runQuery(
            internalAny.dataImport.getFailureReportRows,
            { jobId, cursor, limit: 200 }
          );
          for (const item of page.page) {
            lines.push(
              `${item.sourceIndex + 1}. ${reportLabel(item.content || item.fileName || "Item")}: ${reportLabel(item.failureReason ?? "Import failed")}`
            );
          }
          cursor = page.isDone ? null : page.continueCursor;
        } while (cursor);
        reportKey = `${buildR2UserPrefix(job.userId)}/imports/${jobId}/error-report.txt`;
        await putObjectViaFilesWorker({
          key: reportKey,
          body: new TextEncoder().encode(lines.join("\n")),
          contentType: "text/plain; charset=utf-8",
        });
      }
      await queueImportObjectDeletion(ctx, [job.sourceKey]);
      return { reportKey };
    }
  ),
});

export const cleanupImportJob = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: observeImport(
    "import.cleanup",
    async (ctx, { jobId }: { jobId: string }) => {
      const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
      if (!job) {
        return null;
      }
      await abortImportUpload(job.sourceKey, job.uploadId);
      await queueImportObjectDeletion(ctx, [job.sourceKey, job.reportKey]);
      for (;;) {
        const result = await ctx.runMutation(
          internalAny.dataImport.deleteItemsPage,
          { jobId, limit: 200 }
        );
        if (!result.count) {
          break;
        }
      }
      await ctx.runMutation(internalAny.dataImport.deleteJob, { jobId });
      return null;
    }
  ),
});

export const cleanupExpiredUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: observeImport(
    "import.cleanup_expired",
    async (ctx, _args: Record<string, never>) => {
      const jobs = await ctx.runQuery(
        internalAny.dataImport.findExpiredUploads,
        {
          now: Date.now(),
          limit: 50,
        }
      );
      for (const job of jobs) {
        await abortImportUpload(job.sourceKey, job.uploadId);
        await queueImportObjectDeletion(ctx, [job.sourceKey]);
        await ctx.runMutation(internalAny.dataImport.finishJob, {
          jobId: job._id,
          status: "failed",
          failureClass: "upload_expired",
        });
      }
      return null;
    }
  ),
});

export const deleteAccountImportObjects = internalAction({
  args: {
    objects: v.array(
      v.object({
        sourceKey: v.string(),
        reportKey: v.optional(v.string()),
        uploadId: v.optional(v.string()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { objects }) => {
    for (const object of objects) {
      await abortImportUpload(object.sourceKey, object.uploadId);
      // Persist deletion work before the account cleanup removes these rows.
      await queueImportObjectDeletion(ctx, [
        object.sourceKey,
        object.reportKey,
      ]);
    }
    return null;
  },
});
