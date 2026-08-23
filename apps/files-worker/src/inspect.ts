// Bounded file inspection for the inspect op: reads at most `mb` bytes of an
// object from the R2 binding and extracts preview facts / AI text without the
// object ever transiting a Convex action.
//
// Ports packages/convex/workflows/fileProcessing.ts:
//   - mode "zip"  → archive stats (+ DOCX/PPTX body text) via yauzl there,
//     via a minimal central-directory walker + fflate inflate here
//   - mode "css"  → count of color variable declarations
//   - mode "text" → decoded (optionally RTF-stripped) text for AI analysis

import { inflateSync } from "fflate";

const MAX_AI_TEXT_BYTES = 512 * 1024;
const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024;
const MAX_COMPRESSION_RATIO = 100;

const PPTX_SLIDE_REGEX = /^ppt\/slides\/slide\d+\.xml$/iu;
const PPTX_TEXT_REGEX = /^ppt\/slides\/slide\d+\.xml$/iu;
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
  const partial = await bucket.get(key, {
    range: { offset: 0, length: maxBytes },
  });
  if (!partial) {
    return null;
  }
  return new Uint8Array(await partial.arrayBuffer());
};

interface ZipCentralEntry {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

const EOCD_SIGNATURE = 0x06_05_4b_50;
const CD_ENTRY_SIGNATURE = 0x02_01_4b_50;
const LOCAL_HEADER_SIGNATURE = 0x04_03_4b_50;

/** ZIP integers are little-endian; DataView keeps the bit-twiddling honest. */
const viewFor = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const u16 = (bytes: Uint8Array, offset: number): number =>
  viewFor(bytes).getUint16(offset, true);
const u32 = (bytes: Uint8Array, offset: number): number =>
  viewFor(bytes).getUint32(offset, true);

/**
 * Locate the End of Central Directory record and parse the central directory.
 * Archives inspected here are capped well below zip64 territory, so the
 * classic 32-bit structure is sufficient.
 */
const parseCentralDirectory = (
  bytes: Uint8Array
): { entries: ZipCentralEntry[] } | null => {
  const minEocdOffset = Math.max(0, bytes.length - 22 - 65_536);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocdOffset; i -= 1) {
    if (u32(bytes, i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }

  const entryCount = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const entries: ZipCentralEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      u32(bytes, offset) !== CD_ENTRY_SIGNATURE
    ) {
      break;
    }
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    entries.push({
      name,
      compressionMethod: u16(bytes, offset + 10),
      compressedSize: u32(bytes, offset + 20),
      uncompressedSize: u32(bytes, offset + 24),
      localHeaderOffset: u32(bytes, offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return { entries };
};

/** Decompress one entry's payload given its central-directory descriptor. */
const readEntryBytes = (
  bytes: Uint8Array,
  entry: ZipCentralEntry
): Uint8Array | null => {
  if (
    entry.localHeaderOffset + 30 > bytes.length ||
    u32(bytes, entry.localHeaderOffset) !== LOCAL_HEADER_SIGNATURE
  ) {
    return null;
  }
  const nameLength = u16(bytes, entry.localHeaderOffset + 26);
  const extraLength = u16(bytes, entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  try {
    if (entry.compressionMethod === 0) {
      return raw.slice();
    }
    if (entry.compressionMethod === 8) {
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
 * Inspect an in-memory archive. Mirrors inspectZip in fileProcessing.ts:
 * counts every entry up to MAX_ARCHIVE_ENTRIES, extracts slide/document XML
 * text for Word/PowerPoint previews within the byte/ratio guards.
 */
export const inspectZipInMemory = (
  bytes: Uint8Array,
  formatId: string
): ZipInspection | null => {
  const parsed = parseCentralDirectory(bytes);
  if (!parsed) {
    return null;
  }

  let archiveDirectoryCount = 0;
  let archiveFileCount = 0;
  let inspectedEntryCount = 0;
  let slideCount = 0;
  let textBytes = 0;
  const textParts: string[] = [];

  for (const entry of parsed.entries) {
    inspectedEntryCount += 1;
    if (entry.name.endsWith("/")) {
      archiveDirectoryCount += 1;
    } else {
      archiveFileCount += 1;
    }

    if (PPTX_SLIDE_REGEX.test(entry.name)) {
      slideCount += 1;
    }

    const shouldReadText =
      formatId === "word"
        ? entry.name === DOCX_TEXT_PATH
        : formatId === "powerpoint" && PPTX_TEXT_REGEX.test(entry.name);

    if (
      shouldReadText &&
      textBytes < MAX_AI_TEXT_BYTES &&
      canReadArchiveEntry(entry)
    ) {
      const entryBytes = readEntryBytes(bytes, entry);
      if (entryBytes) {
        textBytes += entryBytes.byteLength;
        if (textBytes <= MAX_AI_TEXT_BYTES) {
          const decoded = decodeXmlText(new TextDecoder().decode(entryBytes));
          if (decoded) {
            textParts.push(decoded);
          }
        }
      }
    }

    if (inspectedEntryCount >= MAX_ARCHIVE_ENTRIES) {
      break;
    }
  }

  return {
    facts: {
      archiveDirectoryCount,
      archiveFileCount,
      inspectedEntryCount,
      ...(formatId === "powerpoint" ? { slideCount } : {}),
    },
    text: textParts.join("\n").trim(),
  };
};

/**
 * Dispatch one inspect request.
 *
 * @param formatId file-format id (zip/word/powerpoint/css tokens/etc.) so the
 *   zip mode knows which entries carry user-visible text
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

  // zip mode: needs the whole (bounded) archive for the central directory.
  const bytes = await boundedRead(bucket, key, maxBytes);
  if (!bytes) {
    throw new InspectSourceMissing();
  }
  const inspection = inspectZipInMemory(bytes, formatId);
  if (!inspection) {
    throw new Error("archive_parse_failed");
  }
  return inspection;
};
