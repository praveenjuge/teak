"use node";

import {
  FILES_UPLOAD_MAX_BYTES,
  type FilesInspectMode,
} from "@teak/files-protocol";
import type { FileFormat, FilePreviewFacts } from "../shared/fileFormats";
import {
  callFilesWorkerJson,
  type FilesWorkerInspectResult,
  type FilesWorkerOutcome,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";

const MAX_ARCHIVE_INSPECTION_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_INSPECTION_BYTES = 2 * 1024 * 1024;

interface FileCardInput {
  fileMetadata?: { kind?: string } | null;
}

const requireWorker = (): void => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
};

export const buildFilePreviewFactsForKey = async (
  sourceKey: string,
  format: FileFormat
): Promise<FilePreviewFacts | null> => {
  let mode: "css" | "zip" | null = null;
  if (["zip", "word", "powerpoint"].includes(format.id)) {
    mode = "zip";
  } else if (format.kind === "tokens" && format.language === "css") {
    mode = "css";
  }
  if (!mode) {
    return null;
  }
  requireWorker();
  const outcome = await callFilesWorkerJson<FilesWorkerInspectResult>({
    op: "inspect",
    params: {
      formatId: format.id,
      maxBytes:
        mode === "zip"
          ? MAX_ARCHIVE_INSPECTION_BYTES
          : MAX_SOURCE_INSPECTION_BYTES,
      mode,
      sourceKey,
    },
  });
  return outcome.kind === "ok"
    ? ((outcome.data.facts as FilePreviewFacts | undefined) ?? null)
    : null;
};

// A Worker deployed before the pdf inspect mode rejects it as invalid input.
const isUnsupportedInspectModeError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith("files_worker_error:INVALID_INPUT:");

/**
 * A document's text from the Files Worker, with the PDF's page count when it
 * reported one. Empty text for formats without text, scans, and documents
 * the Worker declines.
 */
export const extractFileTextForKey = async (
  sourceKey: string,
  format: FileFormat,
  card: FileCardInput
): Promise<{ pageCount?: number; text: string }> => {
  const archive = ["word", "powerpoint"].includes(format.id);
  const pdf = format.kind === "pdf";
  const text = ["markdown", "source", "text", "tokens"].includes(format.kind);
  if (!(archive || pdf || text)) {
    return { text: "" };
  }
  requireWorker();
  let mode: FilesInspectMode = "text";
  let maxBytes = MAX_SOURCE_INSPECTION_BYTES;
  if (archive) {
    mode = "zip";
    maxBytes = MAX_ARCHIVE_INSPECTION_BYTES;
  } else if (pdf) {
    mode = "pdf";
    maxBytes = FILES_UPLOAD_MAX_BYTES;
  }
  let outcome: FilesWorkerOutcome<FilesWorkerInspectResult>;
  try {
    outcome = await callFilesWorkerJson<FilesWorkerInspectResult>({
      op: "inspect",
      params: {
        formatId: format.id,
        maxBytes,
        mode,
        rtf: text && card.fileMetadata?.kind === "text" && format.id === "rtf",
        sourceKey,
      },
    });
  } catch (error) {
    // PDF text is an optional enrichment: until the Worker with the pdf mode
    // is deployed, fall back to the file name instead of failing the step.
    if (pdf && isUnsupportedInspectModeError(error)) {
      return { text: "" };
    }
    throw error;
  }
  if (outcome.kind !== "ok") {
    return { text: "" };
  }
  const pageCount = outcome.data.facts?.pageCount;
  return {
    text: outcome.data.text ?? "",
    ...(typeof pageCount === "number" && { pageCount }),
  };
};

export const extractFileTextForAiForKey = async (
  sourceKey: string,
  format: FileFormat,
  card: FileCardInput
): Promise<string> =>
  (await extractFileTextForKey(sourceKey, format, card)).text;
