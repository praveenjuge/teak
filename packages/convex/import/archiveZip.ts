"use node";

import { PassThrough, Readable } from "node:stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import * as yauzl from "yauzl";
import { MAX_IMPORT_EXPANDED_BYTES, MAX_IMPORT_JSON_BYTES } from "./constants";
import type { createImportS3Client } from "./r2Client";
import { isSafeArchivePath } from "./validate";

class R2RangeReader extends yauzl.RandomAccessReader {
  private readonly bucket: string;
  private readonly client: ReturnType<typeof createImportS3Client>;
  private readonly key: string;

  constructor(
    client: ReturnType<typeof createImportS3Client>,
    bucket: string,
    key: string
  ) {
    super();
    this.bucket = bucket;
    this.client = client;
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
        if (response.Body instanceof Readable) {
          response.Body.pipe(output);
        } else {
          output.destroy(new Error("R2 did not return a readable range"));
        }
      })
      .catch((error) => output.destroy(error as Error));
    return output;
  }
}

export function openZip(
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
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) =>
        error || !zip ? reject(error ?? new Error("Invalid ZIP")) : resolve(zip)
    );
  });
}

export function entryBuffer(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  limit: number
) {
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

export function readZipIndex(zip: yauzl.ZipFile): Promise<ZipIndex> {
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
