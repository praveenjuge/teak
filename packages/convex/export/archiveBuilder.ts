/**
 * Streaming ZIP archive builder.
 *
 * Builds the export archive using `archiver`. File bytes are obtained through an
 * injected async `readFile` reader so this module can be unit tested with mocked
 * R2 streams and reused by the Convex node action with a real R2/S3 reader.
 *
 * Archive layout:
 *   manifest.json
 *   cards.json
 *   files/<cardId>-<sanitized-original-filename>   (only successfully read files)
 *
 * Missing original files get one retry (MISSING_FILE_MAX_ATTEMPTS total
 * attempts) and are then silently omitted from the archive. The card still
 * appears in cards.json, just without a `file` entry.
 */

"use node";

import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import {
  CARDS_ENTRY_NAME,
  MANIFEST_ENTRY_NAME,
  MISSING_FILE_MAX_ATTEMPTS,
} from "./constants";
import {
  buildFilePath,
  buildManifest,
  serializeCard,
  type ExportableCard,
} from "./serialize";

/** A card paired with its original file key (if any). */
export interface ArchiveCardInput {
  card: ExportableCard;
  fileKey?: string;
}

/**
 * Reader for an original file's bytes. Resolves to the file contents, or `null`
 * when the object is missing/unreadable (which triggers retry then omission).
 */
export type FileReader = (
  fileKey: string
) => Promise<Uint8Array | null>;

export interface BuildArchiveResult {
  buffer: Buffer;
  cardCount: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedCardIds: string[];
}

/**
 * Attempt to read a file with one retry. Returns null when all attempts fail or
 * return null. Never throws.
 */
async function readWithRetry(
  readFile: FileReader,
  fileKey: string
): Promise<Uint8Array | null> {
  for (let attempt = 1; attempt <= MISSING_FILE_MAX_ATTEMPTS; attempt++) {
    try {
      const bytes = await readFile(fileKey);
      if (bytes && bytes.byteLength > 0) {
        return bytes;
      }
    } catch {
      // fall through to retry / omission
    }
  }
  return null;
}

function toNodeBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Maximum number of original files read from R2 at once. Bounds peak memory and
 * avoids overwhelming R2 with thousands of simultaneous GetObject requests for
 * large libraries.
 */
const MAX_CONCURRENT_READS = 25;

/**
 * Build the export ZIP archive in memory and return its bytes plus counts.
 *
 * Files are read from the injected reader with bounded concurrency and appended
 * to the archive as soon as their bytes resolve, so raw file buffers are not all
 * held in memory at once. Each card is serialized to reflect whether its file
 * was actually included (missing files are omitted after one retry; the card
 * still appears in cards.json without a `file` entry). The manifest and
 * cards.json are appended once all per-card outcomes are known.
 */
export async function buildExportArchive(args: {
  inputs: ArchiveCardInput[];
  readFile: FileReader;
  createdAtMs: number;
  expiresAtMs: number;
}): Promise<BuildArchiveResult> {
  const { inputs, readFile, createdAtMs, expiresAtMs } = args;

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];

  output.on("data", (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolve, reject) => {
    output.on("end", () => resolve());
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    // `warning` events (e.g. ENOENT for stat) shouldn't abort the in-memory build.
    archive.on("warning", (err) => {
      if ((err as { code?: string }).code !== "ENOENT") {
        reject(err);
      }
    });
  });

  archive.pipe(output);

  const omittedCardIds: string[] = [];
  let filesIncluded = 0;
  let filesOmitted = 0;
  // Preserve input order for deterministic cards.json output.
  const serializedCards: ReturnType<typeof serializeCard>[] = new Array(
    inputs.length
  );

  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= inputs.length) {
        return;
      }
      const input = inputs[index];
      let included = false;
      if (input.fileKey) {
        const bytes = await readWithRetry(readFile, input.fileKey);
        if (bytes) {
          included = true;
          filesIncluded += 1;
          archive.append(toNodeBuffer(bytes), {
            name: buildFilePath(input.card._id, input.card.fileMetadata?.fileName),
          });
        } else {
          filesOmitted += 1;
          omittedCardIds.push(input.card._id);
        }
      }
      serializedCards[index] = serializeCard(input.card, { includeFile: included });
    }
  };

  const workerCount = Math.min(MAX_CONCURRENT_READS, Math.max(inputs.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const manifest = buildManifest({
    createdAtMs,
    expiresAtMs,
    cardCount: serializedCards.length,
    filesIncluded,
    filesOmitted,
  });

  archive.append(JSON.stringify(manifest, null, 2), {
    name: MANIFEST_ENTRY_NAME,
  });
  archive.append(JSON.stringify({ cards: serializedCards }, null, 2), {
    name: CARDS_ENTRY_NAME,
  });

  await archive.finalize();
  await finished;

  return {
    buffer: Buffer.concat(chunks),
    cardCount: serializedCards.length,
    filesIncluded,
    filesOmitted,
    omittedCardIds,
  };
}
