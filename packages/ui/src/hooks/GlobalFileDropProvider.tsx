"use client";

import {
  CARD_ERROR_CODES,
  MAX_FILES_PER_UPLOAD,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { GlobalFileDropOverlay } from "@teak/ui/feedback/GlobalFileDropOverlay";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  CARD_LIMIT_TOAST_MESSAGE,
  TOAST_IDS,
  UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
  UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
  UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
  UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS,
} from "../constants/toast";
import {
  dataTransferHasFiles,
  extractFilesFromDataTransfer,
  formatPartialFailureMessage,
  formatSkippedNote,
  isBlockedDropTarget,
  summarizeBatchResults,
} from "./globalFileDropHelpers";
import { createUploadQueue, type UploadQueueHandlers } from "./uploadQueue";
import { useFileUpload } from "./useFileUpload";
import { useNetworkStatus } from "./useNetworkStatus";

interface GlobalFileDropContextValue {
  /**
   * Programmatically enqueue files (used by the AddCardForm picker so it
   * shares queue/toast state with the global drag/drop).
   */
  enqueueFiles: (files: File[]) => void;
  /**
   * Whether the queue is actively draining.
   */
  isUploading: boolean;
  /**
   * Number of files currently queued (including the one being uploaded).
   */
  queueSize: number;
}

const GlobalFileDropContext = createContext<GlobalFileDropContextValue | null>(
  null
);

interface GlobalFileDropProviderProps {
  children: ReactNode;
  onUpgrade?: () => void;
  upgradeUrl?: string;
}

/**
 * Single authenticated drag/drop + upload queue provider.
 *
 * Mount once per authenticated app surface. The provider:
 *
 *  - Listens for document-level drag/drop events so the whole app accepts
 *    file drops (cards, settings, etc) without per-page wiring.
 *  - Rejects folder drops, offline drops and non-file drops with a single
 *    critical toast each.
 *  - Queues dropped/picked files through the shared `useFileUpload` hook,
 *    enforcing the existing per-upload cap.
 *  - Emits one toast per queue: a non-closable loading toast while the queue
 *    drains, and a result toast on completion (success auto-dismiss, failure
 *    sticky).
 */
export function GlobalFileDropProvider({
  children,
  onUpgrade,
  upgradeUrl,
}: GlobalFileDropProviderProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const { isOnline } = useNetworkStatus();
  const { uploadMultipleFiles } = useFileUpload();

  // Track drag depth so nested elements don't make the overlay flicker.
  const dragDepthRef = useRef(0);

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    if (!upgradeUrl) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    window.location.assign(upgradeUrl);
  }, [onUpgrade, upgradeUrl]);

  const resolveResultToast = useCallback(
    (results: UploadMultipleFilesResultItem[], skippedCount: number) => {
      const summary = summarizeBatchResults(results);
      const skippedNote = formatSkippedNote(skippedCount, MAX_FILES_PER_UPLOAD);
      const withSkippedNote = (message: string) =>
        skippedNote ? `${message} ${skippedNote}` : message;

      if (summary.failures.length === 0) {
        const uploaded =
          summary.total === 1
            ? "File uploaded"
            : `Uploaded ${summary.total} files`;
        if (skippedNote) {
          toast.warning(withSkippedNote(`${uploaded}.`), {
            ...UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          });
          return;
        }
        toast.success(uploaded, {
          ...UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        });
        return;
      }

      const limitFailure = summary.failures.find(
        (failure) =>
          !failure.success &&
          failure.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED
      );
      if (limitFailure) {
        toast.error(withSkippedNote(CARD_LIMIT_TOAST_MESSAGE), {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
          action: {
            label: "Upgrade",
            onClick: handleUpgrade,
          },
        });
        return;
      }

      const rateLimited = summary.failures.find(
        (failure) =>
          !failure.success &&
          failure.errorCode === CARD_ERROR_CODES.RATE_LIMITED
      );
      if (rateLimited) {
        toast.error(
          withSkippedNote("Too many cards created. Please wait a moment."),
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        );
        return;
      }

      if (summary.successCount === 0) {
        const first = summary.firstFailure;
        const reason =
          first && !first.success
            ? (first.error ?? "Upload failed")
            : "Upload failed";
        toast.error(
          withSkippedNote(
            summary.total === 1
              ? reason
              : `Failed to upload ${summary.total} files. ${reason}`
          ),
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        );
        return;
      }

      toast.error(withSkippedNote(formatPartialFailureMessage(summary)), {
        ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
        id: TOAST_IDS.uploadQueue,
      });
    },
    [handleUpgrade]
  );

  const handlersRef = useRef<UploadQueueHandlers | null>(null);
  useEffect(() => {
    handlersRef.current = {
      onFinish: resolveResultToast,
      onSkipped: (skippedCount) =>
        toast.warning(formatSkippedNote(skippedCount, MAX_FILES_PER_UPLOAD), {
          ...UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }),
      onStart: () =>
        toast.loading("Uploading…", {
          ...UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }),
      upload: uploadMultipleFiles,
    };
  }, [resolveResultToast, uploadMultipleFiles]);
  const [queue] = useState(() =>
    createUploadQueue(MAX_FILES_PER_UPLOAD, () => {
      if (!handlersRef.current) {
        throw new Error("The upload queue ran before it mounted");
      }
      return handlersRef.current;
    })
  );
  const { isUploading, queueSize } = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot
  );
  const enqueueValidatedFiles = useCallback(
    (files: File[]) => {
      queue.enqueue(files);
    },
    [queue]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      if (isBlockedDropTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      if (dragDepthRef.current === 1) {
        setIsDragActive(true);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      if (isBlockedDropTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    };

    const resetDragState = () => {
      dragDepthRef.current = 0;
      setIsDragActive(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      if (isBlockedDropTarget(event.target)) {
        resetDragState();
        return;
      }

      event.preventDefault();
      resetDragState();

      const { files, rejectedFolder } = extractFilesFromDataTransfer(
        event.dataTransfer
      );

      if (rejectedFolder) {
        toast.error(
          "Folders can't be uploaded. Drop individual files instead.",
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: "upload-queue-folder",
          }
        );
        if (files.length === 0) {
          return;
        }
      }

      if (files.length === 0) {
        return;
      }

      if (!isOnline) {
        toast.error("You're offline. Reconnect and try again.", {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: "upload-queue-offline",
        });
        return;
      }

      enqueueValidatedFiles(files);
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (!dataTransferHasFiles(event.clipboardData)) {
        return;
      }
      if (isBlockedDropTarget(event.target)) {
        return;
      }

      const { files } = extractFilesFromDataTransfer(event.clipboardData);
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      if (!isOnline) {
        toast.error("You're offline. Reconnect and try again.", {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: "upload-queue-offline",
        });
        return;
      }

      enqueueValidatedFiles(files);
    };

    const handleDragEnd = () => {
      resetDragState();
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("dragend", handleDragEnd);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("dragend", handleDragEnd);
    };
  }, [enqueueValidatedFiles, isOnline]);

  const contextValue = useMemo<GlobalFileDropContextValue>(
    () => ({
      queueSize,
      isUploading,
      enqueueFiles: enqueueValidatedFiles,
    }),
    [enqueueValidatedFiles, isUploading, queueSize]
  );

  return (
    <GlobalFileDropContext.Provider value={contextValue}>
      {children}
      <GlobalFileDropOverlay isDragActive={isDragActive} />
    </GlobalFileDropContext.Provider>
  );
}

/**
 * Read-only access to queue state. Returns `null` when called outside the
 * provider so callers (like `AddCardForm` which is shared with non-web
 * surfaces) can gracefully fall back to their own upload path.
 */
export function useGlobalFileDrop(): GlobalFileDropContextValue | null {
  return use(GlobalFileDropContext);
}
