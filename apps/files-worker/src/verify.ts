import {
  decodeMarkdownUtf8,
  type FileFormat,
  FileFormatValidationError,
  MARKDOWN_CONTENT_MAX_BYTES,
  MAX_FILE_SIZE,
  MarkdownContentError,
  validateFileFormat,
} from "@teak/files-core";
import type {
  FilesFinalizeFacts,
  FilesVerificationLevel,
} from "@teak/files-protocol";
import { detectContainer } from "./detectUpload";
import { inspectImageContainer } from "./imageContainer";
import {
  findPdfStartxref,
  isAsf,
  isAvi,
  isBmp,
  isEbml,
  isFlac,
  isZip,
  type MediaFacts,
  parseAacFacts,
  parseBmpDimensions,
  parseEbmlFacts,
  parseFlacFacts,
  parseFontFamily,
  parseGifDimensions,
  parseIsobmffFacts,
  parseJpegDimensions,
  parseMp3Facts,
  parseOggFacts,
  parsePdfFacts,
  parsePngDimensions,
  parseSfntTables,
  parseTiffDimensions,
  parseWavFacts,
  parseWebpDimensions,
} from "./mediaFacts";
import { readZipDirectory } from "./zip";

const HEAD_WINDOW_BYTES = 64 * 1024;
const TAIL_WINDOW_BYTES = 64 * 1024;
const FULL_DECODE_LIMIT_BYTES = 8 * 1024 * 1024;
const STRUCTURED_JSON_LIMIT_BYTES = 2 * 1024 * 1024;
const GIF_DECODE_LIMIT_BYTES = 1024 * 1024;

export interface VerifiedUpload {
  content?: string;
  facts: FilesFinalizeFacts;
  format: FileFormat;
  mimeType: string;
  /** ETag of the object generation every verification read was bound to. */
  sourceEtag: string;
  verificationLevel: FilesVerificationLevel;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[start + index] ?? 0);
  }
  return out;
};

const isSvgDocument = (bytes: Uint8Array): boolean => {
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  const text = ascii(bytes, offset, Math.min(bytes.length - offset, 2048));
  const stripped = text
    .replace(/^\s+/, "")
    .replace(/^<\?xml[^?]*\?>\s*/, "")
    .replace(/^<!--[\s\S]*?-->\s*/, "")
    .replace(/^<!DOCTYPE[^>]*>\s*/i, "");
  return stripped.toLowerCase().startsWith("<svg");
};
const TEXTUAL_KINDS = new Set(["markdown", "source", "text", "tokens"]);

const isUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

const streamUtf8Valid = async (
  body: ReadableStream<Uint8Array>
): Promise<boolean> => {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        decoder.decode(new Uint8Array(), { stream: false });
        return true;
      }
      if (value) {
        decoder.decode(value, { stream: true });
      }
    }
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
};

const mergeFacts = (
  target: FilesFinalizeFacts,
  facts: MediaFacts | null | undefined
): void => {
  if (!facts) {
    return;
  }
  if (facts.width !== undefined) {
    target.width = facts.width;
  }
  if (facts.height !== undefined) {
    target.height = facts.height;
  }
  if (facts.duration !== undefined) {
    target.duration = facts.duration;
  }
  if (facts.codec !== undefined) {
    target.codec = facts.codec;
  }
  if (facts.container !== undefined) {
    target.container = facts.container;
  }
  if (facts.pageCount !== undefined) {
    target.pageCount = facts.pageCount;
  }
  if (facts.fontFamily !== undefined) {
    target.fontFamily = facts.fontFamily;
  }
  if (facts.fontFormat !== undefined) {
    target.fontFormat = facts.fontFormat;
  }
};

const countTextFacts = (text: string): FilesFinalizeFacts => {
  let lines = 0;
  let words = 0;
  let inWord = false;
  for (const char of text) {
    if (char === "\n") {
      lines += 1;
    }
    if (/\s/.test(char)) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      words += 1;
    }
  }
  return {
    characterCount: text.length,
    lineCount: text.length === 0 ? 0 : lines + 1,
    wordCount: words,
  };
};

const readWindow = async (
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number,
  etag: string,
  size: number
): Promise<Uint8Array> => {
  if (length <= 0 || offset >= size) {
    return new Uint8Array();
  }
  const clamped = Math.min(length, size - offset);
  // rangeRead throws archive_parse_failed on short reads; clamp first so a
  // smaller-than-window object still verifies.
  const object = await bucket.get(key, {
    range: { length: clamped, offset },
  });
  if (!object) {
    throw new Error("source_not_found");
  }
  if (object.httpEtag !== etag) {
    await object.body.cancel();
    throw new Error("source_changed");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== clamped) {
    throw new Error("source_changed");
  }
  return bytes;
};

const walkPdfPageCount = async (
  bucket: R2Bucket,
  key: string,
  etag: string,
  size: number,
  startxref: number
): Promise<number | null> => {
  const readText = async (offset: number, length: number): Promise<string> => {
    if (offset < 0 || offset >= size) {
      return "";
    }
    const bytes = await readWindow(
      bucket,
      key,
      offset,
      Math.min(length, size - offset),
      etag,
      size
    );
    let out = "";
    for (const byte of bytes) {
      out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\n";
    }
    return out;
  };
  // Hop 1: xref table trailer carries the /Root reference.
  const trailer = await readText(startxref, 4096);
  if (!trailer.includes("trailer")) {
    return null;
  }
  const rootRef = /\/Root\s+(\d+)\s+(\d+)\s*R/.exec(trailer);
  if (!rootRef) {
    return null;
  }
  // Hop 2: locate the Root object offset in the xref table.
  const rootNum = Number.parseInt(rootRef[1] ?? "", 10);
  const xrefSection = /xref\s+(\d+)\s+(\d+)([\s\S]*?)trailer/.exec(trailer);
  if (!xrefSection) {
    return null;
  }
  const firstObject = Number.parseInt(xrefSection[1] ?? "", 10);
  const entries = xrefSection[3] ?? "";
  const lines = entries.split("\n").filter((line) => line.trim());
  const rootIndex = rootNum - firstObject;
  if (rootIndex < 0 || rootIndex >= lines.length) {
    return null;
  }
  const rootOffset = Number.parseInt((lines[rootIndex] ?? "").trim(), 10);
  if (!Number.isSafeInteger(rootOffset) || rootOffset < 0) {
    return null;
  }
  // Hop 3: Root object carries the /Pages reference.
  const rootObject = await readText(rootOffset, 4096);
  const pagesRef = /\/Pages\s+(\d+)\s+(\d+)\s*R/.exec(rootObject);
  if (!pagesRef) {
    return null;
  }
  const pagesNum = Number.parseInt(pagesRef[1] ?? "", 10);
  const pagesIndex = pagesNum - firstObject;
  const pagesOffset =
    pagesIndex >= 0 && pagesIndex < lines.length
      ? Number.parseInt((lines[pagesIndex] ?? "").trim(), 10)
      : Number.NaN;
  if (!Number.isSafeInteger(pagesOffset) || pagesOffset < 0) {
    return null;
  }
  // Hop 4: Pages object carries /Count. The dictionary may reference other
  // objects (/Kids, /Parent) between /Type and /Count, so scan lazily.
  const pagesObject = await readText(pagesOffset, 4096);
  const count = /\/Type\s*\/Pages[\s\S]{0,2048}?\/Count\s+(\d+)/.exec(
    pagesObject
  );
  if (!count) {
    return null;
  }
  const pageCount = Number.parseInt(count[1] ?? "", 10);
  return Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null;
};

export const verifyUploadBytes = async (args: {
  bucket: R2Bucket;
  expectedEtag?: string;
  expectedSize?: number;
  fileName: string;
  readText?: boolean;
  requestedMimeType?: string;
  sourceKey: string;
}): Promise<VerifiedUpload> => {
  let format: FileFormat;
  try {
    format = validateFileFormat({
      fileName: args.fileName,
      mimeType: args.requestedMimeType,
    });
  } catch (error) {
    if (error instanceof FileFormatValidationError) {
      if (error.code === "MIME_MISMATCH") {
        throw new Error("invalid_mime_mismatch");
      }
      if (error.code === "UNSUPPORTED_FILE_TYPE") {
        throw new Error("invalid_file_type");
      }
      throw new Error("invalid_file_name");
    }
    throw error;
  }

  const meta = await args.bucket.head(args.sourceKey);
  if (!meta) {
    throw new Error("source_not_found");
  }
  if (
    (args.expectedEtag !== undefined && meta.httpEtag !== args.expectedEtag) ||
    (args.expectedSize !== undefined && meta.size !== args.expectedSize)
  ) {
    throw new Error("source_changed");
  }
  const etag = meta.httpEtag;
  const size = meta.size;

  const head = await readWindow(
    args.bucket,
    args.sourceKey,
    0,
    Math.min(size, HEAD_WINDOW_BYTES),
    etag,
    size
  );
  const tailStart = Math.max(0, size - TAIL_WINDOW_BYTES);
  const tail =
    tailStart > 0 || size > HEAD_WINDOW_BYTES
      ? await readWindow(
          args.bucket,
          args.sourceKey,
          tailStart,
          size - tailStart,
          etag,
          size
        )
      : head;

  const detection = detectContainer(head);
  if (detection && !detection.formatIds.includes(format.id)) {
    throw new Error("invalid_type_mismatch");
  }

  const facts: FilesFinalizeFacts = {};
  let verificationLevel: FilesVerificationLevel = "claimed";
  // Family-level detections (ISO-BMFF, OLE, OGG) accept several claims; the
  // validated extension/MIME claim picks the stored type in that case.
  let mimeType =
    detection && detection.formatIds.length === 1
      ? detection.mimeType
      : format.mimeType;
  let content: string | undefined;

  // ZIP-family containers (archives, Office documents, and ZIP-based design
  // files) verify through the shared bounded directory reader.
  if (isZip(head)) {
    let directory: Awaited<ReturnType<typeof readZipDirectory>>;
    try {
      directory = await readZipDirectory(args.bucket, args.sourceKey, etag);
    } catch {
      throw new Error("invalid_archive_structure");
    }
    let files = 0;
    let directories = 0;
    for (const entry of directory.entries) {
      if (entry.name.endsWith("/")) {
        directories += 1;
      } else {
        files += 1;
      }
    }
    facts.archiveFileCount = files;
    facts.archiveDirectoryCount = directories;
    const names = new Set(directory.entries.map((entry) => entry.name));
    // Each Office subtype requires its own marker: a Word archive claimed
    // as PowerPoint must fail, not be stored under the wrong type.
    const ooxmlMarkers: Record<string, string> = {
      excel: "xl/workbook.xml",
      powerpoint: "ppt/presentation.xml",
      word: "word/document.xml",
    };
    const ooxml =
      names.has("[Content_Types].xml") &&
      Object.values(ooxmlMarkers).some((marker) => names.has(marker));
    if (
      format.id === "zip" ||
      format.kind === "design" ||
      format.id === "pages" ||
      format.id === "numbers"
    ) {
      verificationLevel = "structural";
      if (format.id !== "zip") {
        facts.container = "zip";
      }
    } else if (["word", "powerpoint", "excel"].includes(format.id)) {
      const requiredMarker = ooxmlMarkers[format.id];
      if (!(ooxml && requiredMarker && names.has(requiredMarker))) {
        throw new Error("invalid_type_mismatch");
      }
      verificationLevel = "structural";
      facts.container = "ooxml";
      if (format.id === "powerpoint") {
        let slides = 0;
        for (const name of names) {
          if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
            slides += 1;
          }
        }
        if (slides > 0) {
          facts.pageCount = slides;
        }
      }
    } else {
      throw new Error("invalid_type_mismatch");
    }
    return { facts, format, mimeType, sourceEtag: etag, verificationLevel };
  }

  if (detection) {
    verificationLevel = "structural";
    switch (format.id) {
      case "png":
        mergeFacts(facts, parsePngDimensions(head));
        break;
      case "jpeg":
        mergeFacts(facts, parseJpegDimensions(head));
        break;
      case "gif": {
        mergeFacts(facts, parseGifDimensions(head));
        if (size <= GIF_DECODE_LIMIT_BYTES) {
          const full = await readWindow(
            args.bucket,
            args.sourceKey,
            0,
            size,
            etag,
            size
          );
          const decoded = inspectImageContainer(full);
          if (!decoded || decoded.width === null || decoded.height === null) {
            throw new Error("invalid_image_structure");
          }
          facts.width = decoded.width;
          facts.height = decoded.height;
          verificationLevel = "decoded";
        }
        break;
      }
      case "webp":
        mergeFacts(facts, parseWebpDimensions(head));
        break;
      case "bitmap":
        mergeFacts(
          facts,
          isBmp(head) ? parseBmpDimensions(head) : parseTiffDimensions(head)
        );
        break;
      case "mp4":
      case "quicktime":
      case "mp4-audio":
        mergeFacts(facts, parseIsobmffFacts(head));
        break;
      case "webm":
      case "webm-audio":
        mergeFacts(facts, parseEbmlFacts(head));
        break;
      case "video":
        mergeFacts(facts, isEbml(head) ? parseEbmlFacts(head) : undefined);
        if (isEbml(head)) {
          facts.container = "matroska";
        } else if (isAvi(head)) {
          facts.container = "avi";
        } else if (isAsf(head)) {
          facts.container = "asf";
        } else {
          facts.container = "mpeg";
        }
        break;
      case "mpeg-audio":
        mergeFacts(facts, parseMp3Facts(head));
        break;
      case "wave-audio":
        mergeFacts(facts, parseWavFacts(head, size));
        break;
      case "other-audio":
        mergeFacts(
          facts,
          isFlac(head)
            ? parseFlacFacts(head)
            : parseOggFacts(head, tail.length > 0 ? tail : undefined)
        );
        if (isFlac(head)) {
          facts.container = "flac";
        }
        break;
      case "aac-audio":
        mergeFacts(facts, parseAacFacts(head));
        break;
      case "pdf": {
        const pdf = parsePdfFacts(head, tail);
        if (pdf?.encrypted !== undefined) {
          facts.encrypted = pdf.encrypted;
        }
        facts.container = "pdf";
        const startxref = findPdfStartxref(tail);
        if (startxref !== null) {
          try {
            const pageCount = await walkPdfPageCount(
              args.bucket,
              args.sourceKey,
              etag,
              size,
              startxref
            );
            if (pageCount !== null) {
              facts.pageCount = pageCount;
            }
          } catch {
            // Page counts are best-effort; the container already verified.
          }
        }
        break;
      }
      case "font-truetype":
      case "font-opentype":
      case "font-woff":
      case "font-woff2": {
        const fontFormats: Record<string, string> = {
          "font-opentype": "opentype",
          "font-truetype": "truetype",
          "font-woff": "woff",
          "font-woff2": "woff2",
        };
        facts.fontFormat = fontFormats[format.id] ?? "woff2";
        if (format.id === "font-truetype" || format.id === "font-opentype") {
          // Name tables usually sit inside the head window; fall back to a
          // bounded table-directory read for larger fonts.
          const tables =
            parseSfntTables(head) ??
            (await (async () => {
              const directory = await readWindow(
                args.bucket,
                args.sourceKey,
                0,
                Math.min(size, 4096),
                etag,
                size
              );
              return parseSfntTables(directory);
            })());
          const nameTable = tables?.get("name");
          if (nameTable) {
            const tableBytes =
              nameTable.offset + nameTable.length <= head.length
                ? head
                : await readWindow(
                    args.bucket,
                    args.sourceKey,
                    nameTable.offset,
                    Math.min(nameTable.length, size - nameTable.offset),
                    etag,
                    size
                  );
            const family =
              tableBytes === head
                ? parseFontFamily(head, nameTable)
                : parseFontFamily(tableBytes, {
                    length: nameTable.length,
                    offset: 0,
                  });
            if (family) {
              facts.fontFamily = family;
            }
          }
        }
        break;
      }
      default:
        break;
    }
    return { facts, format, mimeType, sourceEtag: etag, verificationLevel };
  }

  // No conclusive magic bytes: text-family claims verify by strict UTF-8 and
  // structural checks, everything else by validated claim.
  if (TEXTUAL_KINDS.has(format.kind) || format.id === "rtf") {
    if (size > MAX_FILE_SIZE) {
      throw new Error("invalid_file_too_large");
    }
    let text: string | null = null;
    if (args.readText) {
      if (size > MARKDOWN_CONTENT_MAX_BYTES) {
        throw new Error("invalid_content_too_large");
      }
      const full = await readWindow(
        args.bucket,
        args.sourceKey,
        0,
        size,
        etag,
        size
      );
      try {
        text = decodeMarkdownUtf8(full);
      } catch (error) {
        if (error instanceof MarkdownContentError) {
          throw new Error(
            error.code === "INVALID_UTF8"
              ? "invalid_utf8"
              : "invalid_content_too_large"
          );
        }
        throw error;
      }
      content = text;
    } else if (size <= FULL_DECODE_LIMIT_BYTES) {
      const full = await readWindow(
        args.bucket,
        args.sourceKey,
        0,
        size,
        etag,
        size
      );
      if (!isUtf8(full)) {
        throw new Error("invalid_utf8");
      }
      text = new TextDecoder("utf-8", {
        fatal: false,
        ignoreBOM: true,
      }).decode(full);
    } else {
      const object = await args.bucket.get(args.sourceKey);
      if (!object || object.httpEtag !== etag) {
        if (object) {
          await object.body.cancel();
        }
        throw new Error(object ? "source_changed" : "source_not_found");
      }
      if (!(await streamUtf8Valid(object.body))) {
        throw new Error("invalid_utf8");
      }
    }
    verificationLevel = "structural";
    if (text !== null) {
      Object.assign(facts, countTextFacts(text));
      if (format.language === "json" && size <= STRUCTURED_JSON_LIMIT_BYTES) {
        try {
          JSON.parse(text);
        } catch {
          throw new Error("invalid_json_structure");
        }
      }
    }
    return {
      content,
      facts,
      format,
      mimeType,
      sourceEtag: etag,
      verificationLevel,
    };
  }

  if (format.id === "svg" || (format.id === "html" && isSvgDocument(head))) {
    // SVG claims (and SVG-rooted HTML) carry no binary magic; the image
    // pipeline decode-verifies SVG through resvg after finalization.
    verificationLevel = "structural";
    if (format.id === "svg") {
      mimeType = "image/svg+xml";
    }
    return { facts, format, mimeType, sourceEtag: etag, verificationLevel };
  }

  // Opaque formats (design binaries, legacy containers without magic, unknown
  // bytes with a valid extension/MIME agreement) keep working under a
  // validated claim instead of failing verification.
  return { facts, format, mimeType, sourceEtag: etag, verificationLevel };
};
