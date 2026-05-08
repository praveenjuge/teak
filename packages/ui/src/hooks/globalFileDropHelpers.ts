import type { UploadMultipleFilesResultItem } from "@teak/convex/shared";

/**
 * Shared pure helpers used by the global drag-and-drop provider and its tests.
 *
 * Keep these pure so they can be unit-tested without a DOM or React renderer.
 */

export type DropRejectionReason = "folder" | "offline" | "empty" | "over-limit";

export interface ExtractFilesResult {
  files: File[];
  rejectedFolder: boolean;
}

export interface GlobalDropQueueItem {
  file: File;
  id: string;
}

export interface BatchSummary {
  failures: UploadMultipleFilesResultItem[];
  firstFailure?: UploadMultipleFilesResultItem;
  successCount: number;
  total: number;
}

/**
 * Determine whether a single `DataTransferItem` points at a folder/directory.
 *
 * We only have reliable folder detection when `webkitGetAsEntry` is available
 * (all modern browsers and Electron). On that path a directory entry yields
 * `isDirectory === true` or a null file from `getAsFile()`.
 *
 * When `webkitGetAsEntry` is absent we conservatively treat the item as a
 * non-folder so we don't block normal file drops.
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

  // Fallback: no directory API → assume file.
  return false;
}

/**
 * Inspect a `DataTransfer` payload and return plain files plus a folder flag.
 *
 * Caller decides what to do with `rejectedFolder`; this helper never touches
 * toasts so it stays pure.
 */
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

/**
 * Does a `DataTransfer` carry anything that looks like a file?
 *
 * The rework only intercepts file drops; URL/text/plain drops fall through
 * to browser defaults. We inspect `types` because it's populated during the
 * `dragover` phase on every major engine.
 */
export function dataTransferHasFiles(
  dataTransfer: DataTransfer | null | undefined
): boolean {
  if (!dataTransfer) {
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

/**
 * Should drops at this DOM target bypass the global provider?
 *
 * We bail out over text inputs, textareas, any contenteditable, open dialogs,
 * menus, and anything explicitly marked `data-no-drop`. This preserves native
 * paste/drop-into-input behavior and avoids fighting shadcn dialogs.
 */
export function isBlockedDropTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") {
    return false;
  }

  const element = target as Element;

  for (const selector of BLOCKED_SELECTORS) {
    try {
      if (element.closest(selector)) {
        return true;
      }
    } catch {
      // `closest` throws on malformed selectors in some jsdom envs; ignore.
    }
  }

  return false;
}

let queueCounter = 0;

/**
 * Stable-enough identifier for a queued file.
 *
 * We intentionally do NOT key by filename so duplicate drops (e.g. `a.png`
 * twice in one batch) don't collide. `crypto.randomUUID` is used when
 * available; otherwise we fall back to a monotonic counter + timestamp so
 * ids remain unique per session without any runtime dependencies.
 */
export function createQueueItemId(): string {
  queueCounter += 1;
  const globalCrypto: Crypto | undefined =
    typeof globalThis === "undefined"
      ? undefined
      : (globalThis as { crypto?: Crypto }).crypto;

  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }

  return `queue-${Date.now().toString(36)}-${queueCounter.toString(36)}`;
}

/**
 * Resets the internal queue id counter. Exposed for tests.
 */
export function _resetQueueItemIdCounter(): void {
  queueCounter = 0;
}

/**
 * Clip a batch of incoming files so the queue never exceeds `maxTotal`.
 *
 * Returns the files that fit and a count of the rejected ones so the caller
 * can surface a single "too many files" toast if needed.
 */
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

/**
 * Summarize a batch of upload results into the fields the toast layer needs.
 */
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

/**
 * Human-readable partial-failure copy per the rework spec.
 *
 * Example: "Uploaded 3 of 5 files. First failure: video.mov is too large."
 */
export function formatPartialFailureMessage(summary: BatchSummary): string {
  const { total, successCount, firstFailure } = summary;
  const base = `Uploaded ${successCount} of ${total} files.`;
  if (!firstFailure) {
    return base;
  }

  const reason = firstFailure.success
    ? undefined
    : (firstFailure.error ?? "Upload failed");
  if (!reason) {
    return base;
  }

  return `${base} First failure: ${firstFailure.file} — ${reason}`;
}
