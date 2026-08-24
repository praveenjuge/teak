"use node";

import type { FileFormat, FilePreviewFacts } from "../shared/fileFormats";
import {
  callFilesWorkerJson,
  type FilesWorkerInspectResult,
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

export const extractFileTextForAiForKey = async (
  sourceKey: string,
  format: FileFormat,
  card: FileCardInput
): Promise<string> => {
  const archive = ["word", "powerpoint"].includes(format.id);
  const text = ["markdown", "source", "text", "tokens"].includes(format.kind);
  if (!(archive || text)) {
    return "";
  }
  requireWorker();
  const outcome = await callFilesWorkerJson<FilesWorkerInspectResult>({
    op: "inspect",
    params: {
      formatId: format.id,
      maxBytes: archive
        ? MAX_ARCHIVE_INSPECTION_BYTES
        : MAX_SOURCE_INSPECTION_BYTES,
      mode: archive ? "zip" : "text",
      rtf:
        !archive && card.fileMetadata?.kind === "text" && format.id === "rtf",
      sourceKey,
    },
  });
  return outcome.kind === "ok" ? (outcome.data.text ?? "") : "";
};
