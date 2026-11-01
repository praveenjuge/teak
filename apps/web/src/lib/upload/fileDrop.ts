import type { UploadMultipleFilesResultItem } from "@teak/convex/shared";
import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import {
  FILE_FORMATS,
  FILE_VALIDATION_MESSAGES,
  GENERIC_MIME_TYPES,
  MAX_FILE_SIZE,
} from "@teak/convex/shared/fileFormats";
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

export type UploadFailureKind =
  | "empty"
  | "mismatch"
  | "other"
  | "tooLarge"
  | "unsupported";

/** Tells known upload failures apart by code, or by the server's own words
 * where codes repeat (an empty and an unsupported file are both
 * INVALID_INPUT). */
export function uploadFailureKind(failure: {
  error?: string;
  errorCode?: string;
}): UploadFailureKind {
  const { error = "", errorCode } = failure;
  if (error === FILE_VALIDATION_MESSAGES.INVALID_FILE_SIZE) {
    return "empty";
  }
  if (
    errorCode === CARD_ERROR_CODES.FILE_TOO_LARGE ||
    error.startsWith("fileSize must not exceed")
  ) {
    return "tooLarge";
  }
  if (
    errorCode === CARD_ERROR_CODES.UNSUPPORTED_TYPE ||
    error === FILE_VALIDATION_MESSAGES.UNSUPPORTED_FILE_TYPE
  ) {
    return "unsupported";
  }
  if (
    errorCode === CARD_ERROR_CODES.TYPE_MISMATCH ||
    error === FILE_VALIDATION_MESSAGES.MIME_MISMATCH
  ) {
    return "mismatch";
  }
  return "other";
}

const NAMED_FILES = 3;

/** "a.txt, b.txt, c.txt and 2 more", in the reader's language. */
export function formatFileNames(
  names: string[],
  t: UploadMessagesTranslator = englishUpload,
  locale?: string
): string {
  const shown = names.slice(0, NAMED_FILES);
  const rest = names.length - shown.length;
  const items = rest > 0 ? [...shown, t("moreFiles", { count: rest })] : shown;
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(items);
}

const maxFileSizeLabel = (locale?: string) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
  }).format(MAX_FILE_SIZE / (1024 * 1024));

/**
 * One sentence per kind of failure, naming its files. A failure Teak doesn't
 * recognize keeps its own message when the files share one.
 */
export function describeUploadFailures(
  failures: UploadMultipleFilesResultItem[],
  t: UploadMessagesTranslator = englishUpload,
  locale?: string
): string {
  const groups = new Map<UploadFailureKind, UploadMultipleFilesResultItem[]>();
  for (const failure of failures) {
    if (failure.success) {
      continue;
    }
    const kind = uploadFailureKind(failure);
    groups.set(kind, [...(groups.get(kind) ?? []), failure]);
  }
  const sentences: string[] = [];
  for (const [kind, group] of groups) {
    const files = formatFileNames(
      group.map((failure) => failure.file),
      t,
      locale
    );
    const count = group.length;
    if (kind === "other") {
      const reasons = new Set(
        group.map((failure) => (failure.success ? "" : failure.error))
      );
      const [reason] = reasons;
      sentences.push(
        reasons.size === 1 && reason
          ? t("failures.otherWithReason", { files, reason })
          : t("failures.other", { count, files })
      );
    } else if (kind === "tooLarge") {
      sentences.push(
        t("failures.tooLarge", { count, files, max: maxFileSizeLabel(locale) })
      );
    } else {
      sentences.push(t(`failures.${kind}`, { count, files }));
    }
  }
  return sentences.join(" ");
}

export function formatPartialFailureMessage(
  summary: BatchSummary,
  t: UploadMessagesTranslator = englishUpload,
  locale?: string
): string {
  const { failures, successCount, total } = summary;
  const details = describeUploadFailures(failures, t, locale);
  return details
    ? t("partialFailureDetails", { details, successCount, total })
    : t("partialFailure", { successCount, total });
}

/**
 * The file picker's `accept`: every extension and specific media type Teak
 * saves (`FILE_FORMATS`), so the picker greys out the rest.
 */
export function uploadAcceptAttribute(): string {
  const accepted = new Set<string>();
  for (const format of FILE_FORMATS) {
    for (const suffix of format.suffixes) {
      accepted.add(`.${suffix.split(".").pop()}`);
    }
    for (const fileName of format.fileNames ?? []) {
      accepted.add(`.${fileName.split(".").pop()}`);
    }
    for (const mimeType of format.mimeTypes) {
      if (!GENERIC_MIME_TYPES.has(mimeType)) {
        accepted.add(mimeType);
      }
    }
  }
  return [...accepted].join(",");
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
