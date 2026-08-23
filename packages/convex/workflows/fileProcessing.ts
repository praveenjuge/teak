"use node";

import yauzl from "yauzl";
import type { FileFormat, FilePreviewFacts } from "../shared/fileFormats";
import {
  buildSignedWorkerOpUrl,
  callFilesWorkerJson,
  type FilesWorkerInspectResult,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { resolveObjectUrl } from "../storage/r2";

const MAX_AI_TEXT_BYTES = 512 * 1024;
const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024;
const MAX_ARCHIVE_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_DOWNLOAD_BYTES = 2 * 1024 * 1024;
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

interface FileCardInput {
  fileKey?: string;
  fileMetadata?: {
    fileName?: string;
    kind?: string;
    mimeType?: string;
  };
}

interface ZipInspection {
  facts: FilePreviewFacts;
  text: string;
}

const decodeXmlText = (value: string): string =>
  value
    .replace(/<[^>]+>/gu, " ")
    .replace(XML_ENTITY_REGEX, (entity) => XML_ENTITIES[entity] ?? entity)
    .replace(/\s+/gu, " ")
    .trim();

const extractRtfText = (value: string): string =>
  value
    .replace(/\\'[0-9a-f]{2}/giu, " ")
    .replace(/\\[a-z]+-?\d* ?/giu, " ")
    .replace(/[{}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const responseContentLength = (response: Response): number | null => {
  const value = response.headers.get("content-length");
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const fetchBoundedBytes = async (
  url: string,
  maxBytes: number
): Promise<Uint8Array | null> => {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const contentLength = responseContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength <= maxBytes ? bytes : null;
};

const openZip = (bytes: Uint8Array): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("Unable to inspect archive"));
          return;
        }
        resolve(zip);
      }
    );
  });

const readEntryText = (
  zip: yauzl.ZipFile,
  entry: yauzl.Entry
): Promise<string> =>
  new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Unable to read archive entry"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  });

const canReadArchiveEntry = (entry: yauzl.Entry): boolean => {
  if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
    return false;
  }
  if (entry.compressedSize === 0) {
    return entry.uncompressedSize === 0;
  }
  return entry.uncompressedSize / entry.compressedSize <= MAX_COMPRESSION_RATIO;
};

export const inspectZip = async (
  bytes: Uint8Array,
  format: FileFormat
): Promise<ZipInspection> => {
  const zip = await openZip(bytes);
  let archiveDirectoryCount = 0;
  let archiveFileCount = 0;
  let inspectedEntryCount = 0;
  let slideCount = 0;
  let textBytes = 0;
  let settled = false;
  const textParts: string[] = [];

  return new Promise((resolve, reject) => {
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      zip.close();
      resolve({
        facts: {
          archiveDirectoryCount,
          archiveFileCount,
          inspectedEntryCount,
          ...(format.id === "powerpoint" ? { slideCount } : {}),
        },
        text: textParts.join("\n").trim(),
      });
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      zip.close();
      reject(error);
    };

    zip.on("error", fail);
    zip.on("end", finish);
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        inspectedEntryCount += 1;
        const isDirectory = entry.fileName.endsWith("/");
        if (isDirectory) {
          archiveDirectoryCount += 1;
        } else {
          archiveFileCount += 1;
        }

        if (PPTX_SLIDE_REGEX.test(entry.fileName)) {
          slideCount += 1;
        }

        const shouldReadText =
          format.id === "word"
            ? entry.fileName === DOCX_TEXT_PATH
            : format.id === "powerpoint" &&
              PPTX_TEXT_REGEX.test(entry.fileName);

        if (
          shouldReadText &&
          textBytes < MAX_AI_TEXT_BYTES &&
          canReadArchiveEntry(entry)
        ) {
          const rawText = await readEntryText(zip, entry);
          textBytes += Buffer.byteLength(rawText);
          if (textBytes <= MAX_AI_TEXT_BYTES) {
            const decoded = decodeXmlText(rawText);
            if (decoded) {
              textParts.push(decoded);
            }
          }
        }

        if (inspectedEntryCount >= MAX_ARCHIVE_ENTRIES) {
          finish();
          return;
        }
        zip.readEntry();
      })().catch(fail);
    });

    zip.readEntry();
  });
};

export const buildFilePreviewFacts = async (
  url: string,
  format: FileFormat
): Promise<FilePreviewFacts | null> => {
  if (["zip", "word", "powerpoint"].includes(format.id)) {
    const bytes = await fetchBoundedBytes(url, MAX_ARCHIVE_DOWNLOAD_BYTES);
    if (!bytes) {
      return null;
    }
    return (await inspectZip(bytes, format)).facts;
  }

  if (format.kind === "tokens" && format.language === "css") {
    const bytes = await fetchBoundedBytes(url, MAX_SOURCE_DOWNLOAD_BYTES);
    if (!bytes) {
      return null;
    }
    const text = new TextDecoder().decode(bytes);
    return {
      colorVariableCount: Array.from(text.matchAll(CSS_COLOR_VARIABLE_REGEX))
        .length,
    };
  }

  return null;
};

export const extractFileTextForAi = async (
  url: string,
  format: FileFormat,
  card: FileCardInput
): Promise<string> => {
  if (["word", "powerpoint"].includes(format.id)) {
    const bytes = await fetchBoundedBytes(url, MAX_ARCHIVE_DOWNLOAD_BYTES);
    return bytes ? (await inspectZip(bytes, format)).text : "";
  }

  if (!["markdown", "source", "text", "tokens"].includes(format.kind)) {
    return "";
  }

  const bytes = await fetchBoundedBytes(url, MAX_SOURCE_DOWNLOAD_BYTES);
  if (!bytes) {
    return "";
  }
  const decoded = new TextDecoder().decode(bytes.slice(0, MAX_AI_TEXT_BYTES));
  return card.fileMetadata?.kind === "text" && format.id === "rtf"
    ? extractRtfText(decoded)
    : decoded.trim();
};

/* ------------------------------------------------------------------ *
 * Files-worker backed variants.
 *
 * The worker reads the object over its R2 binding and returns facts/text
 * as JSON, so bounded inspection no longer pulls up to 25 MB through an
 * action's memory. Both wrappers fall back to the URL-based legacy
 * implementations above when the worker is unconfigured or rejects the
 * request permanently (missing source, malformed archive).
 * ------------------------------------------------------------------ */

export const buildFilePreviewFactsForKey = async (
  key: string,
  format: FileFormat
): Promise<FilePreviewFacts | null> => {
  if (isFilesWorkerConfigured()) {
    let mode: "zip" | "css" | null = null;
    if (["zip", "word", "powerpoint"].includes(format.id)) {
      mode = "zip";
    } else if (format.kind === "tokens" && format.language === "css") {
      mode = "css";
    }
    if (mode) {
      const maxBytes =
        mode === "zip" ? MAX_ARCHIVE_DOWNLOAD_BYTES : MAX_SOURCE_DOWNLOAD_BYTES;
      try {
        const url = await buildSignedWorkerOpUrl({
          op: "inspect",
          key,
          params: { mode, mb: String(maxBytes), rtf: "", fmt: format.id },
        });
        const outcome =
          await callFilesWorkerJson<FilesWorkerInspectResult>(url);
        if (outcome.kind === "ok") {
          return (outcome.data.facts as FilePreviewFacts | undefined) ?? null;
        }
      } catch {
        // Transient worker failure → legacy path below keeps this best-effort.
      }
    } else {
      return null;
    }
  }
  const url = await resolveObjectUrl(key);
  return url ? buildFilePreviewFacts(url, format) : null;
};

export const extractFileTextForAiForKey = async (
  key: string,
  format: FileFormat,
  card: FileCardInput
): Promise<string> => {
  if (isFilesWorkerConfigured()) {
    const isArchive = ["word", "powerpoint"].includes(format.id);
    const isTextKind = ["markdown", "source", "text", "tokens"].includes(
      format.kind
    );
    if (isArchive || isTextKind) {
      try {
        const url = await buildSignedWorkerOpUrl({
          op: "inspect",
          key,
          params: {
            mode: isArchive ? "zip" : "text",
            mb: String(
              isArchive ? MAX_ARCHIVE_DOWNLOAD_BYTES : MAX_SOURCE_DOWNLOAD_BYTES
            ),
            rtf:
              !isArchive &&
              card.fileMetadata?.kind === "text" &&
              format.id === "rtf"
                ? "1"
                : "",
            fmt: format.id,
          },
        });
        const outcome =
          await callFilesWorkerJson<FilesWorkerInspectResult>(url);
        if (outcome.kind === "ok") {
          return outcome.data.text ?? "";
        }
      } catch {
        // Transient worker failure → legacy path below.
      }
    } else {
      return "";
    }
  }
  const url = await resolveObjectUrl(key);
  return url ? extractFileTextForAi(url, format, card) : "";
};
