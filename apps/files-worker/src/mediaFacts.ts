/**
 * Bounded, dependency-free container parsers for upload verification.
 *
 * Every parser reads only the bytes it is given and returns facts it can
 * derive confidently. Parsers never throw for malformed input: they return
 * null and the caller falls back to a weaker verification level.
 *
 * This module holds the PDF and font parsers and re-exports the image,
 * media, and detection parsers so existing import sites keep working.
 */

import { ascii, type MediaFacts, u16be, u32be } from "./mediaBytes";
import { isPdf } from "./mediaDetect";

export type { MediaFacts } from "./mediaBytes";
export {
  fontFormatOf,
  isAacAdts,
  isAsf,
  isAvi,
  isBmp,
  isEbml,
  isFlac,
  isGif,
  isIsobmff,
  isJpeg,
  isMatroska,
  isMp3,
  isMpegPs,
  isMpegTs,
  isOgg,
  isOle,
  isobmffBrand,
  isPdf,
  isPng,
  isTiff,
  isWav,
  isWebm,
  isWebp,
  isZip,
} from "./mediaDetect";
export {
  parseBmpDimensions,
  parseGifDimensions,
  parseJpegDimensions,
  parsePngDimensions,
  parseTiffDimensions,
  parseWebpDimensions,
} from "./mediaFactsImage";
export {
  parseAacFacts,
  parseEbmlFacts,
  parseFlacFacts,
  parseIsobmffFacts,
  parseMp3Facts,
  parseOggFacts,
  parseWavFacts,
} from "./mediaFactsMedia";

export const parsePdfFacts = (
  head: Uint8Array,
  tail?: Uint8Array
): (MediaFacts & { encrypted?: boolean }) | null => {
  if (!isPdf(head)) {
    return null;
  }
  const facts: MediaFacts & { encrypted?: boolean } = { container: "pdf" };
  // ASCII-only scan avoids decoding binary object streams.
  const scan = (bytes: Uint8Array): string => {
    let out = "";
    for (const byte of bytes) {
      out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\n";
      if (out.length > 131_072) {
        break;
      }
    }
    return out;
  };
  const text = tail ? `${scan(head)}\n${scan(tail)}` : scan(head);
  if (/\/Encrypt\b/.test(text)) {
    facts.encrypted = true;
  }
  return facts;
};

export const findPdfStartxref = (tail: Uint8Array): number | null => {
  let text = "";
  for (const byte of tail) {
    text +=
      byte === 10 || byte === 13 || (byte >= 32 && byte < 127)
        ? String.fromCharCode(byte)
        : " ";
  }
  const match = /startxref\s+(\d+)\s*%%EOF?/.exec(text);
  if (!match) {
    return null;
  }
  const offset = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
};

interface SfntTable {
  length: number;
  offset: number;
}

export const parseSfntTables = (
  bytes: Uint8Array,
  base = 0
): Map<string, SfntTable> | null => {
  const tables = new Map<string, SfntTable>();
  const count = u16be(bytes, base + 4);
  if (count === 0 || count > 64 || base + 12 + count * 16 > bytes.length) {
    return null;
  }
  for (let index = 0; index < count; index += 1) {
    const entry = base + 12 + index * 16;
    tables.set(ascii(bytes, entry, 4), {
      length: u32be(bytes, entry + 12),
      offset: u32be(bytes, entry + 8),
    });
  }
  return tables;
};

export const parseFontFamily = (
  bytes: Uint8Array,
  nameTable: SfntTable
): string | null => {
  const { length, offset } = nameTable;
  if (offset + 6 > bytes.length || length < 6 || length > 65_536) {
    return null;
  }
  const count = u16be(bytes, offset + 2);
  const stringOffset = u16be(bytes, offset + 4);
  if (count > 256 || offset + 6 + count * 12 > bytes.length) {
    return null;
  }
  let fallback: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const record = offset + 6 + index * 12;
    const platformId = u16be(bytes, record);
    const nameId = u16be(bytes, record + 6);
    const stringLength = u16be(bytes, record + 8);
    const stringStart = offset + stringOffset + u16be(bytes, record + 10);
    if (nameId !== 1 || stringLength === 0 || stringLength > 512) {
      continue;
    }
    if (stringStart + stringLength > bytes.length) {
      continue;
    }
    const raw = bytes.subarray(stringStart, stringStart + stringLength);
    let value: string | null = null;
    try {
      value =
        platformId === 3 || platformId === 0
          ? new TextDecoder("utf-16be", {
              fatal: true,
              ignoreBOM: true,
            }).decode(raw)
          : new TextDecoder("macintosh").decode(raw);
    } catch {
      continue;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars from font names is the intent.
    value = value.replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
    if (!value) {
      continue;
    }
    if (platformId === 3) {
      return value;
    }
    fallback ??= value;
  }
  return fallback;
};
