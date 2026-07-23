"use node";

import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { v } from "convex/values";
import type yauzl from "yauzl";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import {
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
} from "../shared/markdown";
import { TELEMETRY_OPERATIONS } from "../shared/telemetry";
import { buildR2UserPrefix } from "../storage/r2";
import {
  recordBackendHandledFailure,
  withBackendSpan,
} from "../telemetry/sentry";
import { entryBuffer, openZip, readZipIndex } from "./archiveZip";
import { type ParsedBookmarkItem, parseBookmarksHtml } from "./bookmarks";
import {
  IMPORT_INDEX_BATCH,
  type ImportMode,
  MAX_BOOKMARK_BYTES,
  MAX_IMPORT_FILE_BYTES,
  MAX_RAINDROP_BYTES,
} from "./constants";
import { resolveLegacyMarkdownImport } from "./markdown";
import { createImportS3Client, getImportR2Config } from "./r2Client";
import { parseRaindropCsv } from "./raindrop";
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
  entries: Map<string, yauzl.Entry>,
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

async function storeItems(ctx: any, jobId: string, items: any[]) {
  for (let index = 0; index < items.length; index += IMPORT_INDEX_BATCH) {
    await ctx.runMutation(internalAny.dataImport.insertItems, {
      jobId,
      items: items.slice(index, index + IMPORT_INDEX_BATCH),
    });
  }
}

async function decodeLegacyMarkdownItems(
  client: ReturnType<typeof createImportS3Client>,
  bucket: string,
  key: string,
  size: number,
  items: any[]
) {
  const needed = new Map<string, any>(
    items
      .filter(
        (item) =>
          item.status === "pending" &&
          item.type === "document" &&
          item.filePath &&
          item.fileName &&
          isMarkdownFileName(item.fileName)
      )
      .map((item) => [item.filePath, item] as [string, any])
  );
  if (!needed.size) {
    return;
  }

  const zip = await openZip(client, bucket, key, size);
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        void (async () => {
          const item = needed.get(entry.fileName);
          if (item) {
            try {
              const bytes = await entryBuffer(
                zip,
                entry,
                MARKDOWN_CONTENT_MAX_BYTES
              );
              Object.assign(item, resolveLegacyMarkdownImport(item, bytes));
            } catch (error) {
              item.status = "failed";
              item.failureCode = "CONTENT_TOO_LARGE";
              item.failureReason =
                error instanceof Error
                  ? error.message
                  : "Markdown file could not be imported";
            }
            needed.delete(entry.fileName);
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function indexParsedBookmarks(
  ctx: any,
  jobId: string,
  parsed: ParsedBookmarkItem[],
  mode: ImportMode
) {
  assertImportCardCount(parsed.length, mode);
  const seen = new Set<string>();
  const items = parsed.map((item, sourceIndex) =>
    item.card
      ? normalizeIndexItem(item.card, sourceIndex, new Map(), seen)
      : {
          sourceIndex,
          status: "failed" as const,
          type: "text" as const,
          content: item.label,
          failureCode: "INVALID_BOOKMARK",
          failureReason: item.error,
        }
  );
  await storeItems(ctx, jobId, items);
}

export const indexImportSource = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ ok: v.boolean(), failureClass: v.optional(v.string()) }),
  handler: observeImport(
    "import.index",
    async (ctx, { jobId }: { jobId: string }) => {
      const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
      if (!job) {
        return { ok: false, failureClass: "missing_job" };
      }
      const config = getImportR2Config();
      const client = createImportS3Client(config);
      try {
        if (job.mode === "bookmarks" || job.mode === "raindrop") {
          const isRaindrop = job.mode === "raindrop";
          const maxBytes = isRaindrop ? MAX_RAINDROP_BYTES : MAX_BOOKMARK_BYTES;
          if (job.fileSize > maxBytes) {
            throw new Error(
              isRaindrop
                ? "Raindrop CSV exceeds 20 MiB"
                : "Bookmark file exceeds 20 MiB"
            );
          }
          const response = await client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
          );
          const bytes = await response.Body?.transformToByteArray();
          if (!bytes || bytes.byteLength !== job.fileSize) {
            throw new Error(
              isRaindrop
                ? "Raindrop source could not be read"
                : "Bookmark source could not be read"
            );
          }
          const text = Buffer.from(bytes).toString("utf8");
          const parsed = isRaindrop
            ? parseRaindropCsv(text)
            : parseBookmarksHtml(text);
          await indexParsedBookmarks(
            ctx,
            jobId,
            parsed,
            job.mode as ImportMode
          );
        } else {
          const zip = await openZip(
            client,
            config.bucket,
            job.sourceKey,
            job.fileSize
          );
          try {
            const index = await readZipIndex(zip);
            const manifest = index.manifest as any;
            const version = manifest?.version ?? manifest?.exportVersion;
            if (version !== 1) {
              throw new Error("Unsupported Teak archive version");
            }
            const rawCards = Array.isArray(manifest?.cards)
              ? manifest.cards
              : index.cards;
            if (!Array.isArray(rawCards)) {
              throw new Error("Archive is missing cards");
            }
            assertImportCardCount(rawCards.length, job.mode as ImportMode);
            const seen = new Set<string>();
            const items = rawCards.map((card, sourceIndex) =>
              normalizeIndexItem(card, sourceIndex, index.entries, seen)
            );
            await decodeLegacyMarkdownItems(
              client,
              config.bucket,
              job.sourceKey,
              job.fileSize,
              items
            );
            await storeItems(ctx, jobId, items);
          } finally {
            zip.close();
          }
        }
        return { ok: true };
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

export const extractImportFiles = internalAction({
  args: { jobId: v.id("importJobs"), itemIds: v.array(v.id("importJobItems")) },
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
      const config = getImportR2Config();
      const client = createImportS3Client(config);
      const zip = await openZip(
        client,
        config.bucket,
        job.sourceKey,
        job.fileSize
      );
      try {
        await new Promise<void>((resolve, reject) => {
          zip.on("error", reject);
          zip.on("end", resolve);
          zip.on("entry", (entry) => {
            void (async () => {
              const item = needed.get(entry.fileName);
              if (item) {
                const key = deterministicFileKey(
                  job.userId,
                  jobId,
                  item._id,
                  item.fileName ?? "file"
                );
                const stream = await new Promise<Readable>((res, rej) =>
                  zip.openReadStream(entry, (error, value) =>
                    error || !value
                      ? rej(error ?? new Error("Unreadable file entry"))
                      : res(value)
                  )
                );
                await client.send(
                  new PutObjectCommand({
                    Bucket: config.bucket,
                    Key: key,
                    Body: stream,
                    ContentLength: entry.uncompressedSize,
                    ContentType: item.mimeType,
                  })
                );
                await ctx.runMutation(internalAny.dataImport.setExtractedFile, {
                  itemId: item._id,
                  key,
                });
                needed.delete(entry.fileName);
              }
              zip.readEntry();
            })().catch(reject);
          });
          zip.readEntry();
        });
        if (needed.size) {
          return { ok: false, failureClass: "missing_file_entry" };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          failureClass:
            error instanceof Error
              ? error.message.slice(0, 160)
              : "file_extract_failed",
        };
      } finally {
        zip.close();
      }
    }
  ),
});

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
      const config = getImportR2Config();
      const client = createImportS3Client(config);
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
              `${item.sourceIndex + 1}. ${item.content || item.fileName}: ${item.failureReason ?? "Import failed"}`
            );
          }
          cursor = page.isDone ? null : page.continueCursor;
        } while (cursor);
        reportKey = `${buildR2UserPrefix(job.userId)}/imports/${jobId}/error-report.txt`;
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: reportKey,
            Body: lines.join("\n"),
            ContentType: "text/plain; charset=utf-8",
            ContentDisposition: 'attachment; filename="teak-import-report.txt"',
          })
        );
      }
      await client
        .send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
        )
        .catch(() => undefined);
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
      const config = getImportR2Config();
      const client = createImportS3Client(config);
      if (job.uploadId) {
        await client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: job.sourceKey,
              UploadId: job.uploadId,
            })
          )
          .catch(() => undefined);
      }
      for (const key of [job.sourceKey, job.reportKey].filter(Boolean)) {
        await client
          .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
          .catch(() => undefined);
      }
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
        const config = getImportR2Config();
        const client = createImportS3Client(config);
        if (job.uploadId) {
          await client
            .send(
              new AbortMultipartUploadCommand({
                Bucket: config.bucket,
                Key: job.sourceKey,
                UploadId: job.uploadId,
              })
            )
            .catch(() => undefined);
        }
        await client
          .send(
            new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: job.sourceKey,
            })
          )
          .catch(() => undefined);
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
  handler: async (_ctx, { objects }) => {
    const config = getImportR2Config();
    const client = createImportS3Client(config);
    for (const object of objects) {
      if (object.uploadId) {
        await client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: object.sourceKey,
              UploadId: object.uploadId,
            })
          )
          .catch(() => undefined);
      }
      for (const key of [object.sourceKey, object.reportKey].filter(Boolean)) {
        await client
          .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
          .catch(() => undefined);
      }
    }
    return null;
  },
});
