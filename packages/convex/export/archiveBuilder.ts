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
 * Build the export ZIP archive in memory and return its bytes plus counts.
 *
 * The function first resolves all file bytes (with retry/omit), then serializes
 * cards (omitted files produce cards without a `file` entry), then writes the
 * manifest, cards.json, and each included file into the archive.
 */
export async function buildExportArchive(args: {
  inputs: ArchiveCardInput[];
  readFile: FileReader;
  createdAtMs: number;
  expiresAtMs: number;
}): Promise<BuildArchiveResult> {
  const { inputs, readFile, createdAtMs, expiresAtMs } = args;

  // Resolve file bytes up front so manifest counts and cards.json reflect the
  // exact set of files actually included.
  const resolved = await Promise.all(
    inputs.map(async (input) => {
      if (!input.fileKey) {
        return { input, bytes: null as Uint8Array | null };
      }
      const bytes = await readWithRetry(readFile, input.fileKey);
      return { input, bytes };
    })
  );

  const omittedCardIds: string[] = [];
  let filesIncluded = 0;
  let filesOmitted = 0;

  const serializedCards = resolved.map(({ input, bytes }) => {
    const hasFileIntent = Boolean(input.fileKey);
    const included = Boolean(bytes);
    if (hasFileIntent && !included) {
      filesOmitted += 1;
      omittedCardIds.push(input.card._id);
    }
    if (included) {
      filesIncluded += 1;
    }
    return serializeCard(input.card, { includeFile: included });
  });

  const manifest = buildManifest({
    createdAtMs,
    expiresAtMs,
    cardCount: serializedCards.length,
    filesIncluded,
    filesOmitted,
  });

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

  archive.append(JSON.stringify(manifest, null, 2), {
    name: MANIFEST_ENTRY_NAME,
  });
  archive.append(JSON.stringify({ cards: serializedCards }, null, 2), {
    name: CARDS_ENTRY_NAME,
  });

  for (const { input, bytes } of resolved) {
    if (!bytes) {
      continue;
    }
    const entryName = buildFilePath(
      input.card._id,
      input.card.fileMetadata?.fileName
    );
    archive.append(toNodeBuffer(bytes), { name: entryName });
  }

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
