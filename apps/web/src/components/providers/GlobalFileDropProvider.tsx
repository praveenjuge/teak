"use client";

import {
  CARD_ERROR_CODES,
  MAX_FILES_PER_UPLOAD,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
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
import { GlobalFileDropOverlay } from "@/components/feedback/GlobalFileDropOverlay";
import {
  TOAST_IDS,
  UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
  UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
  UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
  UPLOAD_QUEUE_SUCCESS_TOAST_OPTIONS,
} from "../../constants/toast";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { useServerErrors } from "../../hooks/useServerErrors";
import {
  dataTransferHasFiles,
  describeUploadFailures,
  extractFilesFromDataTransfer,
  formatPartialFailureMessage,
  formatSkippedNote,
  isBlockedDropTarget,
  summarizeBatchResults,
} from "../../lib/upload/fileDrop";
import {
  createUploadQueue,
  type UploadQueueHandlers,
} from "../../lib/upload/queue";

export type PasteClaim = (event: ClipboardEvent) => boolean;

interface GlobalFileDropContextValue {
  claimPaste: (claim: PasteClaim) => () => void;
  enqueueFiles: (files: File[]) => void;
  isUploading: boolean;
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

export function GlobalFileDropProvider({
  children,
  onUpgrade,
  upgradeUrl,
}: GlobalFileDropProviderProps) {
  const t = useTranslations("providers.fileDrop");
  const tUpload = useTranslations("lib.upload");
  const serverErrors = useServerErrors();
  const intlLocale = useIntlLocale();
  const [isDragActive, setIsDragActive] = useState(false);
  const { isOnline } = useNetworkStatus();
  const { uploadMultipleFiles } = useFileUpload();

  // Track drag depth so nested elements don't make the overlay flicker.
  const dragDepthRef = useRef(0);
  const pasteClaimsRef = useRef<PasteClaim[]>([]);
  const claimPaste = useCallback((claim: PasteClaim) => {
    pasteClaimsRef.current.push(claim);
    return () => {
      const index = pasteClaimsRef.current.lastIndexOf(claim);
      if (index >= 0) {
        pasteClaimsRef.current.splice(index, 1);
      }
    };
  }, []);

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
      const skippedNote = formatSkippedNote(
        skippedCount,
        MAX_FILES_PER_UPLOAD,
        tUpload
      );
      const withSkippedNote = (message: string) =>
        skippedNote ? `${message} ${skippedNote}` : message;

      if (summary.failures.length === 0) {
        if (skippedNote) {
          toast.warning(
            withSkippedNote(t("uploadedSentence", { count: summary.total })),
            {
              ...UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
              id: TOAST_IDS.uploadQueue,
            }
          );
          return;
        }
        toast.success(t("uploaded", { count: summary.total }), {
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
        toast.error(withSkippedNote(t("cardLimitReached")), {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
          action: {
            label: t("upgrade"),
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
        toast.error(withSkippedNote(t("rateLimited")), {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        });
        return;
      }

      // Known failures read as friendly sentences naming every file; others
      // keep the server's reason, translated where Teak knows it.
      const failures = summary.failures.map((failure) =>
        failure.success
          ? failure
          : { ...failure, error: serverErrors.byEnglishMessage(failure.error) }
      );
      const described = { ...summary, failures };

      if (summary.successCount === 0) {
        const reason =
          describeUploadFailures(failures, tUpload, intlLocale) ||
          t("uploadFailed");
        toast.error(
          withSkippedNote(
            summary.total === 1
              ? reason
              : t("uploadFailedMany", { count: summary.total, reason })
          ),
          {
            ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        );
        return;
      }

      toast.error(
        withSkippedNote(
          formatPartialFailureMessage(described, tUpload, intlLocale)
        ),
        {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }
      );
    },
    [handleUpgrade, intlLocale, serverErrors, t, tUpload]
  );

  const handlersRef = useRef<UploadQueueHandlers | null>(null);
  useEffect(() => {
    handlersRef.current = {
      onFinish: resolveResultToast,
      onSkipped: (skippedCount) =>
        toast.warning(
          formatSkippedNote(skippedCount, MAX_FILES_PER_UPLOAD, tUpload),
          {
            ...UPLOAD_QUEUE_NOTICE_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        ),
      onStart: () =>
        toast.loading(t("uploading"), {
          ...UPLOAD_QUEUE_LOADING_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }),
      upload: uploadMultipleFiles,
    };
  }, [resolveResultToast, t, tUpload, uploadMultipleFiles]);
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
      // Entering a blocked target never counted, so leaving it can't either.
      if (isBlockedDropTarget(event.target)) {
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
        toast.error(t("foldersNotSupported"), {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: "upload-queue-folder",
        });
        if (files.length === 0) {
          return;
        }
      }

      if (files.length === 0) {
        return;
      }

      if (!isOnline) {
        toast.error(t("offline"), {
          ...UPLOAD_QUEUE_CRITICAL_TOAST_OPTIONS,
          id: "upload-queue-offline",
        });
        return;
      }

      enqueueValidatedFiles(files);
    };

    const handlePaste = (event: ClipboardEvent) => {
      const claims = pasteClaimsRef.current;
      if (claims[claims.length - 1]?.(event)) {
        return;
      }
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
        toast.error(t("offline"), {
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
  }, [enqueueValidatedFiles, isOnline, t]);

  const contextValue = useMemo<GlobalFileDropContextValue>(
    () => ({
      claimPaste,
      queueSize,
      isUploading,
      enqueueFiles: enqueueValidatedFiles,
    }),
    [claimPaste, enqueueValidatedFiles, isUploading, queueSize]
  );

  return (
    <GlobalFileDropContext.Provider value={contextValue}>
      {children}
      <GlobalFileDropOverlay isDragActive={isDragActive} />
    </GlobalFileDropContext.Provider>
  );
}

export function useGlobalFileDrop(): GlobalFileDropContextValue | null {
  return use(GlobalFileDropContext);
}
