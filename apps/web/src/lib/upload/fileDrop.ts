import type { UploadMultipleFilesResultItem } from "@teak/convex/shared";
import type { TeakTranslator } from "@teak/i18n";
import { englishTranslator } from "../englishTranslators";
import { CARD_DRAG_TYPE } from "../folders";

export type DropRejectionReason = "folder" | "offline" | "empty" | "over-limit";

export interface ExtractFilesResult {
  files: File[];
  rejectedFolder: boolean;
}

export interface BatchSummary {
  failures: UploadMultipleFilesResultItem[];
  firstFailure?: UploadMultipleFilesResultItem;
  successCount: number;
  total: number;
}

/**
 * Folder detection needs `webkitGetAsEntry`: a directory entry yields
 * `isDirectory === true` or a null file from `getAsFile()`.
 */
export function isDataTransferItemFolder(item: DataTransferItem): boolean {
  if (item.kind !== "file") {
    return false;
  }

  type EntryCapable = DataTransferItem & {
    webkitGetAsEntry?: () => { isDirectory?: boolean; isFile?: boolean } | null;
  };
  const entryCapable = item as EntryCapable;

  if (typeof entryCapable.webkitGetAsEntry === "function") {
    const entry = entryCapable.webkitGetAsEntry();
    if (entry?.isDirectory) {
      return true;
    }
    if (entry && entry.isFile === false && entry.isDirectory === undefined) {
      return true;
    }
    return false;
  }

  return false;
}

export function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined
): ExtractFilesResult {
  if (!dataTransfer) {
    return { files: [], rejectedFolder: false };
  }

  let rejectedFolder = false;
  const files: File[] = [];

  // Prefer items: it's the only API that can distinguish folders.
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") {
        continue;
      }
      if (isDataTransferItemFolder(item)) {
        rejectedFolder = true;
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
    return { files, rejectedFolder };
  }

  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      files.push(file);
    }
  }

  return { files, rejectedFolder };
}

/** `types` is populated during the `dragover` phase on every major engine. */
export function dataTransferHasFiles(
  dataTransfer: DataTransfer | null | undefined
): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (
    dataTransfer.types &&
    typeof dataTransfer.types !== "string" &&
    Array.from(dataTransfer.types as ArrayLike<string>).includes(CARD_DRAG_TYPE)
  ) {
    return false;
  }

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file") {
        return true;
      }
    }
    return false;
  }

  if (dataTransfer.types && typeof dataTransfer.types !== "string") {
    const types = Array.from(dataTransfer.types as ArrayLike<string>);
    return types.includes("Files");
  }

  return false;
}

const BLOCKED_SELECTORS = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
  "textarea",
  '[contenteditable="true"]',
  "[data-no-drop]",
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
];

export function isBlockedDropTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }

  const element = target as Element;

  return BLOCKED_SELECTORS.some((selector) => element.closest(selector));
}

export function capBatchForQueue(
  incoming: File[],
  currentQueueSize: number,
  maxTotal: number
): { accepted: File[]; rejectedCount: number; totalAfter: number } {
  const capacity = Math.max(0, maxTotal - currentQueueSize);
  if (incoming.length <= capacity) {
    return {
      accepted: incoming,
      rejectedCount: 0,
      totalAfter: currentQueueSize + incoming.length,
    };
  }

  const accepted = incoming.slice(0, capacity);
  return {
    accepted,
    rejectedCount: incoming.length - capacity,
    totalAfter: currentQueueSize + accepted.length,
  };
}

export function summarizeBatchResults(
  results: UploadMultipleFilesResultItem[]
): BatchSummary {
  const total = results.length;
  const failures = results.filter(
    (result) => !result.success
  ) as UploadMultipleFilesResultItem[];
  const successCount = total - failures.length;
  return {
    total,
    successCount,
    failures,
    firstFailure: failures[0],
  };
}

export type UploadMessagesTranslator = TeakTranslator<"lib.upload">;

const englishUpload: UploadMessagesTranslator = englishTranslator("lib.upload");

export function formatPartialFailureMessage(
  summary: BatchSummary,
  t: UploadMessagesTranslator = englishUpload
): string {
  const { total, successCount, firstFailure } = summary;
  const reason =
    firstFailure && !firstFailure.success ? firstFailure.error : undefined;
  if (!(firstFailure && reason)) {
    return t("partialFailure", { successCount, total });
  }
  return t("partialFailureWithReason", {
    successCount,
    total,
    file: firstFailure.file,
    reason,
  });
}

export function formatSkippedNote(
  skippedCount: number,
  maxFiles: number,
  t: UploadMessagesTranslator = englishUpload
): string {
  if (skippedCount <= 0) {
    return "";
  }
  return t("skippedNote", { count: skippedCount, max: maxFiles });
}
