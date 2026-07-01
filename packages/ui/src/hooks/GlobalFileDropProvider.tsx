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
} from "react";
import { toast } from "sonner";
import {
  TOAST_IDS,
  UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
  UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
  UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS,
} from "../constants/toast";
import {
  capBatchForQueue,
  createQueueItemId,
  dataTransferHasFiles,
  extractFilesFromDataTransfer,
  formatPartialFailureMessage,
  type GlobalDropQueueItem,
  isBlockedDropTarget,
  summarizeBatchResults,
} from "./globalFileDropHelpers";
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
  const [queue, setQueue] = useState<GlobalDropQueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { isOnline } = useNetworkStatus();
  const { uploadMultipleFiles } = useFileUpload();

  // Ref the queue so the drain loop always sees the latest appended files.
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Track drag depth so nested elements don't make the overlay flicker.
  const dragDepthRef = useRef(0);
  const uploadingRef = useRef(false);
  const batchAggregateRef = useRef<UploadMultipleFilesResultItem[]>([]);

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
    (results: UploadMultipleFilesResultItem[]) => {
      const summary = summarizeBatchResults(results);

      if (summary.failures.length === 0) {
        toast.success(
          summary.total === 1
            ? "File uploaded"
            : `Uploaded ${summary.total} files`,
          {
            ...UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        );
        return;
      }

      // Card limit wins over every other failure reason so users always see
      // the upgrade CTA.
      const limitFailure = summary.failures.find(
        (failure) =>
          !failure.success &&
          failure.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED
      );
      if (limitFailure) {
        toast.error(
          "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
            action: {
              label: "Upgrade",
              onClick: handleUpgrade,
            },
          }
        );
        return;
      }

      const rateLimited = summary.failures.find(
        (failure) =>
          !failure.success &&
          failure.errorCode === CARD_ERROR_CODES.RATE_LIMITED
      );
      if (rateLimited) {
        toast.error("Too many cards created. Please wait a moment.", {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        });
        return;
      }

      if (summary.successCount === 0) {
        const first = summary.firstFailure;
        const reason =
          first && !first.success
            ? (first.error ?? "Upload failed")
            : "Upload failed";
        toast.error(
          summary.total === 1
            ? reason
            : `Failed to upload ${summary.total} files. ${reason}`,
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        );
        return;
      }

      toast.error(formatPartialFailureMessage(summary), {
        ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
        id: TOAST_IDS.uploadQueue,
      });
    },
    [handleUpgrade]
  );

  const drainQueue = useCallback(async () => {
    if (uploadingRef.current) {
      return;
    }
    uploadingRef.current = true;
    setIsUploading(true);

    toast.loading("Uploading…", {
      ...UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
      id: TOAST_IDS.uploadQueue,
    });
    batchAggregateRef.current = [];

    try {
      // Keep draining as long as new files were appended during upload.
      while (queueRef.current.length > 0) {
        const snapshot = queueRef.current;
        const files = snapshot.map((item) => item.file);
        // The queue is drained one snapshot at a time; each pass must finish
        // before the next so files appended mid-upload are handled in order.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const results = await uploadMultipleFiles(files);
        batchAggregateRef.current = batchAggregateRef.current.concat(results);

        // Pop the slice we just uploaded; anything appended in-flight stays.
        setQueue((previous) => previous.slice(snapshot.length));
        // Update ref eagerly so the next loop iteration sees the new length
        // before the setState flushes.
        queueRef.current = queueRef.current.slice(snapshot.length);
      }

      resolveResultToast(batchAggregateRef.current);
    } finally {
      batchAggregateRef.current = [];
      uploadingRef.current = false;
      setIsUploading(false);
    }
  }, [resolveResultToast, uploadMultipleFiles]);

  const enqueueValidatedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const currentSize = queueRef.current.length;
      const { accepted, rejectedCount } = capBatchForQueue(
        files,
        currentSize,
        MAX_FILES_PER_UPLOAD
      );

      if (rejectedCount > 0) {
        toast.error(
          `You can only upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`,
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: "upload-queue-too-many",
          }
        );
      }

      if (accepted.length === 0) {
        return;
      }

      const newItems: GlobalDropQueueItem[] = accepted.map((file) => ({
        id: createQueueItemId(),
        file,
      }));
      setQueue((previous) => {
        const next = previous.concat(newItems);
        queueRef.current = next;
        return next;
      });

      void drainQueue();
    },
    [drainQueue]
  );

  // Document-level drag/drop wiring.
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

    const handleDragEnd = () => {
      resetDragState();
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragend", handleDragEnd);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragend", handleDragEnd);
    };
  }, [enqueueValidatedFiles, isOnline]);

  const contextValue = useMemo<GlobalFileDropContextValue>(
    () => ({
      queueSize: queue.length,
      isUploading,
      enqueueFiles: enqueueValidatedFiles,
    }),
    [enqueueValidatedFiles, isUploading, queue.length]
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
