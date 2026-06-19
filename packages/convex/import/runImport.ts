"use node";

import { PassThrough, Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { v } from "convex/values";
import yauzl from "yauzl";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildR2UserPrefix } from "../storage/r2";
import { parseBookmarksHtml } from "./bookmarks";
import {
  IMPORT_INDEX_BATCH,
  MAX_BOOKMARK_BYTES,
  MAX_IMPORT_EXPANDED_BYTES,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_JSON_BYTES,
  type ImportMode,
} from "./constants";
import { createImportS3Client, getImportR2Config } from "./r2Client";
import {
  assertImportCardCount,
  isSafeArchivePath,
  validateImportCard,
} from "./validate";

const internalAny = internal as Record<string, any>;

class R2RangeReader extends yauzl.RandomAccessReader {
  private readonly client: ReturnType<typeof createImportS3Client>;
  private readonly bucket: string;
  private readonly key: string;

  constructor(
    client: ReturnType<typeof createImportS3Client>,
    bucket: string,
    key: string
  ) {
    super();
    this.client = client;
    this.bucket = bucket;
    this.key = key;
  }
  _readStreamForRange(start: number, end: number) {
    const output = new PassThrough();
    void this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key,
          Range: `bytes=${start}-${end - 1}`,
        })
      )
      .then((response) => {
        const body = response.Body;
        if (body instanceof Readable) {
          body.pipe(output);
        } else {
          output.destroy(new Error("R2 did not return a readable range"));
        }
      })
      .catch((error) => output.destroy(error as Error));
    return output;
  }
}

function openZip(
  client: ReturnType<typeof createImportS3Client>,
  bucket: string,
  key: string,
  size: number
) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromRandomAccessReader(
      new R2RangeReader(client, bucket, key),
      size,
      {
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) =>
        error || !zip ? reject(error ?? new Error("Invalid ZIP")) : resolve(zip)
    );
  });
}

function entryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number) {
  if (entry.uncompressedSize > limit) {
    return Promise.reject(new Error(`${entry.fileName} is too large`));
  }
  return new Promise<Buffer>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        return reject(error ?? new Error("ZIP entry is unreadable"));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          stream.destroy(new Error("Expanded ZIP entry exceeds its limit"));
        } else {
          chunks.push(chunk);
        }
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

interface ZipIndex {
  cards?: unknown[];
  entries: Map<string, yauzl.Entry>;
  manifest?: unknown;
}

function readZipIndex(zip: yauzl.ZipFile): Promise<ZipIndex> {
  const entries = new Map<string, yauzl.Entry>();
  let manifest: unknown;
  let cards: unknown[] | undefined;
  let expanded = 0;
  return new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", () => resolve({ entries, manifest, cards }));
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        if (
          !isSafeArchivePath(entry.fileName) ||
          entry.generalPurposeBitFlag % 2 !== 0
        ) {
          throw new Error("Archive contains an unsafe or encrypted entry");
        }
        if (![0, 8].includes(entry.compressionMethod)) {
          throw new Error("Archive uses unsupported compression");
        }
        expanded += entry.uncompressedSize;
        if (expanded > MAX_IMPORT_EXPANDED_BYTES) {
          throw new Error("Archive expands beyond 5 GiB");
        }
        if (!entry.fileName.endsWith("/")) {
          if (entries.has(entry.fileName)) {
            throw new Error(
              `Archive contains a duplicate entry: ${entry.fileName}`
            );
          }
          entries.set(entry.fileName, entry);
        }
        if (entry.fileName === "manifest.json") {
          manifest = JSON.parse(
            (await entryBuffer(zip, entry, MAX_IMPORT_JSON_BYTES)).toString(
              "utf8"
            )
          );
        }
        if (entry.fileName === "cards.json") {
          const parsed = JSON.parse(
            (await entryBuffer(zip, entry, MAX_IMPORT_JSON_BYTES)).toString(
              "utf8"
            )
          );
          cards = Array.isArray(parsed) ? parsed : parsed?.cards;
        }
        zip.readEntry();
      })().catch(reject);
    });
    zip.readEntry();
  });
}

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

export const indexImportSource = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ ok: v.boolean(), failureClass: v.optional(v.string()) }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(internalAny.dataImport.getJob, { jobId });
    if (!job) {
      return { ok: false, failureClass: "missing_job" };
    }
    const config = getImportR2Config();
    const client = createImportS3Client(config);
    try {
      if (job.mode === "bookmarks") {
        if (job.fileSize > MAX_BOOKMARK_BYTES) {
          throw new Error("Bookmark file exceeds 20 MiB");
        }
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
        );
        const bytes = await response.Body?.transformToByteArray();
        if (!bytes || bytes.byteLength !== job.fileSize) {
          throw new Error("Bookmark source could not be read");
        }
        const parsed = parseBookmarksHtml(Buffer.from(bytes).toString("utf8"));
        assertImportCardCount(parsed.length, job.mode as ImportMode);
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
          await storeItems(
            ctx,
            jobId,
            rawCards.map((card, sourceIndex) =>
              normalizeIndexItem(card, sourceIndex, index.entries, seen)
            )
          );
        } finally {
          zip.close();
        }
      }
      return { ok: true };
    } catch (error) {
      console.error("[import/index]", error);
      return {
        ok: false,
        failureClass:
          error instanceof Error ? error.message.slice(0, 160) : "parse_failed",
      };
    }
  },
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
  handler: async (ctx, { jobId, itemIds }) => {
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
  },
});

export const finalizeImportObjects = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.object({ reportKey: v.optional(v.string()) }),
  handler: async (ctx, { jobId }) => {
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
  },
});

export const cleanupImportJob = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
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
  },
});

export const cleanupExpiredUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const jobs = await ctx.runQuery(internalAny.dataImport.findExpiredUploads, {
      now: Date.now(),
      limit: 50,
    });
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
          new DeleteObjectCommand({ Bucket: config.bucket, Key: job.sourceKey })
        )
        .catch(() => undefined);
      await ctx.runMutation(internalAny.dataImport.finishJob, {
        jobId: job._id,
        status: "failed",
        failureClass: "upload_expired",
      });
    }
    return null;
  },
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
