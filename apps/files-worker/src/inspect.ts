// Bounded file inspection for the inspect op: extracts preview facts / AI text
// from an object in the R2 binding without the object ever transiting a
// Convex action.
//
// Ports packages/convex/workflows/fileProcessing.ts:
//   - mode "zip"  → archive stats (+ DOCX/PPTX body text). Uses R2 ranged
//     reads (EOCD → central directory → selected local entries) so even
//     multi-GB archives cost kilobytes of memory instead of being buffered.
//   - mode "pdf"  → page count + bounded first-pages text via pdfium
//   - mode "css"  → count of color variable declarations
//   - mode "text" → decoded (optionally RTF-stripped) text for AI analysis

import { inflateSync } from "fflate";
import { MAX_PDF_BYTES, openPdf } from "./wasm";

const MAX_AI_TEXT_BYTES = 512 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024;
const MAX_COMPRESSION_RATIO = 100;

/** Never read more than this for any single central directory. */
const MAX_CENTRAL_DIRECTORY_BYTES = 32 * 1024 * 1024;
/** EOCD is at most 22 bytes + up to 64KiB of archive comment. */
const EOCD_SEARCH_WINDOW = 22 + 65_536;
/** Local file header: fixed part only. */
const LOCAL_HEADER_FIXED_BYTES = 30;

const PDF_MAX_TEXT_PAGES = 30;

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

export type InspectMode = "css" | "pdf" | "text" | "zip";

export interface InspectResult {
  facts?: Record<string, number>;
  text?: string;
}

export class InspectSourceMissing extends Error {
  constructor() {
    super("source_not_found");
  }
}

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
 * Read exactly [offset, offset+length) from an object via ranged get().
 */
const rangeRead = async (
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number
): Promise<Uint8Array> => {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) {
    throw new InspectSourceMissing();
  }
  return new Uint8Array(await object.arrayBuffer());
};

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

/* ------------------------------------------------------------------ *
 * ZIP central-directory walking over ranged reads.
 *
 * ZIP integers are little-endian; DataView keeps the bit-twiddling honest.
 * Archives inspected here are capped well below zip64 territory, so the
 * classic 32-bit structure is sufficient.
 * ------------------------------------------------------------------ */

export interface ZipCentralEntry {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

interface EocdRecord {
  cdOffset: number;
  cdSize: number;
  entryCount: number;
}

const EOCD_SIGNATURE = 0x06_05_4b_50;
const CD_ENTRY_SIGNATURE = 0x02_01_4b_50;
const LOCAL_HEADER_SIGNATURE = 0x04_03_4b_50;

const u16 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    true
  );
const u32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true
  );

/** Locate and parse the End of Central Directory record inside a tail slice. */
export const findEocd = (tail: Uint8Array): EocdRecord | null => {
  if (tail.length < 22) {
    return null;
  }
  let eocd = -1;
  for (
    let i = tail.length - 22;
    i >= Math.max(0, tail.length - EOCD_SEARCH_WINDOW);
    i -= 1
  ) {
    if (u32(tail, i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  return {
    entryCount: u16(tail, eocd + 10),
    cdSize: u32(tail, eocd + 12),
    cdOffset: u32(tail, eocd + 16),
  };
};

/** Parse central directory entries from a CD byte slice. */
export const parseCentralDirectory = (
  cdBytes: Uint8Array,
  entryCount: number
): ZipCentralEntry[] => {
  const entries: ZipCentralEntry[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  for (
    let index = 0;
    index < Math.min(entryCount, MAX_ARCHIVE_ENTRIES);
    index += 1
  ) {
    if (
      offset + 46 > cdBytes.length ||
      u32(cdBytes, offset) !== CD_ENTRY_SIGNATURE
    ) {
      break;
    }
    const nameLength = u16(cdBytes, offset + 28);
    const extraLength = u16(cdBytes, offset + 30);
    const commentLength = u16(cdBytes, offset + 32);
    entries.push({
      name: decoder.decode(
        cdBytes.subarray(offset + 46, offset + 46 + nameLength)
      ),
      compressionMethod: u16(cdBytes, offset + 10),
      compressedSize: u32(cdBytes, offset + 20),
      uncompressedSize: u32(cdBytes, offset + 24),
      localHeaderOffset: u32(cdBytes, offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

/** Decompress one entry's payload given its raw local data slice. */
export const inflateEntryData = (
  raw: Uint8Array,
  compressionMethod: number
): Uint8Array | null => {
  try {
    if (compressionMethod === 0) {
      return raw.slice();
    }
    if (compressionMethod === 8) {
      return inflateSync(raw);
    }
    return null;
  } catch {
    return null;
  }
};

const canReadArchiveEntry = (entry: ZipCentralEntry): boolean => {
  if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
    return false;
  }
  if (entry.compressedSize === 0) {
    return entry.uncompressedSize === 0;
  }
  return entry.uncompressedSize / entry.compressedSize <= MAX_COMPRESSION_RATIO;
};

export interface ZipInspection {
  facts: {
    archiveDirectoryCount: number;
    archiveFileCount: number;
    inspectedEntryCount: number;
    slideCount?: number;
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
  const meta = await bucket.head(key);
  if (!meta || meta.size < 22) {
    throw new Error("archive_parse_failed");
  }

  const tailLength = Math.min(meta.size, EOCD_SEARCH_WINDOW);
  const tail = await rangeRead(bucket, key, meta.size - tailLength, tailLength);
  const eocd = findEocd(tail);
  if (!eocd) {
    throw new Error("archive_parse_failed");
  }
  if (
    eocd.cdOffset >= meta.size ||
    eocd.cdSize > MAX_CENTRAL_DIRECTORY_BYTES ||
    eocd.cdOffset + eocd.cdSize > meta.size ||
    eocd.entryCount === 0
  ) {
    throw new Error("archive_parse_failed");
  }

  const cdBytes = await rangeRead(bucket, key, eocd.cdOffset, eocd.cdSize);
  const entries = parseCentralDirectory(cdBytes, eocd.entryCount);

  let archiveDirectoryCount = 0;
  let archiveFileCount = 0;
  let slideCount = 0;
  let textBytes = 0;
  const textParts: string[] = [];
  const decoder = new TextDecoder();

  for (const entry of entries.slice(0, MAX_ARCHIVE_ENTRIES)) {
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
      !canReadArchiveEntry(entry)
    ) {
      continue;
    }

    // Local headers carry their own name/extra lengths which may differ from
    // the central directory's, so read the fixed header first.
    if (entry.localHeaderOffset + LOCAL_HEADER_FIXED_BYTES > meta.size) {
      continue;
    }
    const localHeader = await rangeRead(
      bucket,
      key,
      entry.localHeaderOffset,
      LOCAL_HEADER_FIXED_BYTES
    );
    if (u32(localHeader, 0) !== LOCAL_HEADER_SIGNATURE) {
      continue;
    }
    const dataStart =
      entry.localHeaderOffset +
      LOCAL_HEADER_FIXED_BYTES +
      u16(localHeader, 26) +
      u16(localHeader, 28);
    if (dataStart + entry.compressedSize > meta.size) {
      continue;
    }
    const raw = await rangeRead(bucket, key, dataStart, entry.compressedSize);
    const entryBytes = inflateEntryData(raw, entry.compressionMethod);
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

  return {
    facts: {
      archiveDirectoryCount,
      archiveFileCount,
      inspectedEntryCount: entries.length,
      ...(formatId === "powerpoint" ? { slideCount } : {}),
    },
    text: textParts.join("\n").trim(),
  };
};

/**
 * Dispatch one inspect request.
 *
 * @param formatId file-format id (zip/word/powerpoint/css/pdf tokens/etc.) so
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
      },
    };
  }

  if (mode === "text") {
    const bytes = await boundedRead(bucket, key, maxBytes);
    if (!bytes) {
      throw new InspectSourceMissing();
    }
    const decoded = new TextDecoder().decode(bytes.slice(0, MAX_AI_TEXT_BYTES));
    return {
      text: rtf ? extractRtfText(decoded).trim() : decoded.trim(),
    };
  }

  // pdf mode: render-free text extraction + page count via pdfium.
  const bytes = await boundedRead(
    bucket,
    key,
    Math.min(maxBytes, MAX_PDF_BYTES)
  );
  if (!bytes) {
    throw new InspectSourceMissing();
  }
  let doc: Awaited<ReturnType<typeof openPdf>>;
  try {
    doc = await openPdf(bytes);
  } catch {
    throw new Error("pdf_parse_failed");
  }
  try {
    const pageCount = doc.getPageCount();
    const parts: string[] = [];
    let totalChars = 0;
    for (
      let pageIndex = 0;
      pageIndex < Math.min(pageCount, PDF_MAX_TEXT_PAGES) &&
      totalChars < MAX_AI_TEXT_BYTES;
      pageIndex += 1
    ) {
      const pageText = doc.getPage(pageIndex).getText();
      if (!pageText) {
        continue;
      }
      totalChars += pageText.length;
      parts.push(
        pageText.length > MAX_AI_TEXT_BYTES
          ? pageText.slice(0, MAX_AI_TEXT_BYTES)
          : pageText
      );
      if (totalChars >= MAX_AI_TEXT_BYTES) {
        break;
      }
    }
    return {
      facts: { pageCount },
      text: parts.join("\n").trim().slice(0, MAX_AI_TEXT_BYTES),
    };
  } finally {
    doc.destroy();
  }
};
