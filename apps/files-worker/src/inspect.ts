// Bounded file inspection for the inspect op: extracts preview facts / AI text
// from an object in the R2 binding without the object ever transiting a
// Convex action.
//
// Ports packages/convex/workflows/fileProcessing.ts:
//   - mode "zip"  → archive stats (+ DOCX/PPTX body text). Uses R2 ranged
//     reads (EOCD → central directory → selected local entries) so even
//     multi-GB archives cost kilobytes of memory instead of being buffered.
//   - mode "css"  → count of color variable declarations
//   - mode "text" → decoded (optionally RTF-stripped) text for AI analysis

import {
  InspectSourceMissing,
  rangeRead,
  readZipDirectory,
  readZipEntry,
} from "./zip";

export {
  extractZipEntries,
  findEocd,
  InspectSourceMissing,
  parseCentralDirectory,
  rangeRead,
} from "./zip";

const MAX_AI_TEXT_BYTES = 512 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024;
const PPTX_SLIDE_REGEX = /^ppt\/slides\/slide\d+\.xml$/iu;
const DOCX_TEXT_PATH = "word/document.xml";
const XML_ENTITY_REGEX = /&(amp|apos|gt|lt|quot|#39);/gu;
const XML_ENTITIES: Record<string, string> = {
  "&#39;": "'",
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};
const CSS_COLOR_VARIABLE_REGEX =
  /--[a-z0-9_-]+\s*:\s*(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklab|oklch|lab|lch|color)\([^;]+\))/giu;

export type InspectMode = "css" | "text" | "zip";

export interface InspectResult {
  facts?: Record<string, number>;
  text?: string;
}

const textFacts = (text: string): Record<string, number> => ({
  characterCount: text.length,
  headingCount: Array.from(text.matchAll(/^\s{0,3}#{1,6}\s+/gmu)).length,
  lineCount: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
  wordCount: Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu))
    .length,
});

const decodeXmlText = (value: string): string =>
  value
    .replace(/<[^>]+>/gu, " ")
    .replace(XML_ENTITY_REGEX, (entity) => XML_ENTITIES[entity] ?? entity)
    .replace(/\s+/gu, " ")
    .trim();

export const extractRtfText = (value: string): string =>
  value
    .replace(/\\'[0-9a-f]{2}/giu, " ")
    .replace(/\\[a-z]+-?\d* ?/giu, " ")
    .replace(/[{}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * Read at most maxBytes bytes of an object; null when missing, and objects
 * larger than the cap resolve to exactly maxBytes bytes (callers treat
 * truncation as acceptable — mirrors fetchBoundedBytes' content-length guard
 * plus streaming fallback).
 */
const boundedRead = async (
  bucket: R2Bucket,
  key: string,
  maxBytes: number
): Promise<Uint8Array | null> => {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  if ((object.size ?? 0) <= maxBytes) {
    return new Uint8Array(await object.arrayBuffer());
  }
  // Larger than the cap: read only the prefix we would have used anyway.
  await object.body.cancel();
  const partial = await rangeRead(bucket, key, 0, maxBytes);
  return partial;
};

export interface ZipInspection {
  facts: {
    archiveDirectoryCount: number;
    archiveFileCount: number;
    compressedBytes: number;
    inspectedEntryCount: number;
    slideCount?: number;
    uncompressedBytes: number;
    wordCount?: number;
  };
  text: string;
}

/**
 * Inspect an archive using only ranged reads: the EOCD tail, the central
 * directory, and the handful of DOCX/PPTX entries that carry preview text.
 * Memory stays flat regardless of archive size.
 */
export const inspectZipRanged = async (
  bucket: R2Bucket,
  key: string,
  formatId: string
): Promise<ZipInspection> => {
  const directory = await readZipDirectory(bucket, key);
  const entries = directory.entries;

  let archiveDirectoryCount = 0;
  let archiveFileCount = 0;
  let slideCount = 0;
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  let textBytes = 0;
  const textParts: string[] = [];
  const decoder = new TextDecoder();

  for (const entry of entries.slice(0, MAX_ARCHIVE_ENTRIES)) {
    compressedBytes += entry.compressedSize;
    uncompressedBytes += entry.uncompressedSize;
    if (entry.name.endsWith("/")) {
      archiveDirectoryCount += 1;
    } else {
      archiveFileCount += 1;
    }

    if (formatId === "powerpoint" && PPTX_SLIDE_REGEX.test(entry.name)) {
      slideCount += 1;
    }

    const shouldReadText =
      formatId === "word"
        ? entry.name === DOCX_TEXT_PATH
        : formatId === "powerpoint" && PPTX_SLIDE_REGEX.test(entry.name);

    if (
      !shouldReadText ||
      textBytes >= MAX_AI_TEXT_BYTES ||
      entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES
    ) {
      continue;
    }

    const entryBytes = await readZipEntry(
      bucket,
      key,
      directory,
      entry,
      MAX_ARCHIVE_ENTRY_BYTES
    ).catch(() => null);
    if (!entryBytes) {
      continue;
    }
    textBytes += entryBytes.byteLength;
    if (textBytes <= MAX_AI_TEXT_BYTES) {
      const decoded = decodeXmlText(decoder.decode(entryBytes));
      if (decoded) {
        textParts.push(decoded);
      }
    }
  }

  const text = textParts.join("\n").trim();
  return {
    facts: {
      archiveDirectoryCount,
      archiveFileCount,
      compressedBytes,
      inspectedEntryCount: entries.length,
      ...(formatId === "powerpoint" ? { slideCount } : {}),
      ...(text ? { wordCount: textFacts(text).wordCount } : {}),
      uncompressedBytes,
    },
    text,
  };
};

/**
 * Dispatch one inspect request.
 *
 * @param formatId file-format id (zip/word/powerpoint/css tokens/etc.) so
 *   structured modes know what they are looking at
 * @param rtf when true, text mode applies the RTF control-word stripper
 */
export const runInspect = async (
  bucket: R2Bucket,
  key: string,
  mode: InspectMode,
  formatId: string,
  maxBytes: number,
  rtf: boolean
): Promise<InspectResult> => {
  if (mode === "zip") {
    // Ranged path never buffers the archive; maxBytes no longer bounds it.
    return await inspectZipRanged(bucket, key, formatId);
  }

  if (mode === "css") {
    const bytes = await boundedRead(bucket, key, maxBytes);
    if (!bytes) {
      throw new InspectSourceMissing();
    }
    const text = new TextDecoder().decode(bytes);
    return {
      facts: {
        colorVariableCount: Array.from(text.matchAll(CSS_COLOR_VARIABLE_REGEX))
          .length,
        ...textFacts(text),
      },
    };
  }

  if (mode === "text") {
    const bytes = await boundedRead(bucket, key, maxBytes);
    if (!bytes) {
      throw new InspectSourceMissing();
    }
    const decoded = new TextDecoder().decode(bytes.slice(0, MAX_AI_TEXT_BYTES));
    const text = rtf ? extractRtfText(decoded).trim() : decoded.trim();
    return { facts: textFacts(text), text };
  }

  throw new Error(`invalid_mode:${mode}`);
};
