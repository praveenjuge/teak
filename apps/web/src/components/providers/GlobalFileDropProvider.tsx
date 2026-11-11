"use client";

import {
  CARD_ERROR_CODES,
  MAX_FILES_PER_UPLOAD,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
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
import { type ExternalToast, toast } from "sonner";
import { GlobalFileDropOverlay } from "@/components/feedback/GlobalFileDropOverlay";
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "../../constants/toast";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { useServerErrors } from "../../hooks/useServerErrors";
import { useUpgradeAction } from "../../hooks/useUpgradeAction";
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

const LOADING_TOAST_OPTIONS: ExternalToast = {
  duration: Number.POSITIVE_INFINITY,
  closeButton: false,
  dismissible: false,
};

const SUCCESS_TOAST_OPTIONS: ExternalToast = {
  duration: 4000,
  closeButton: false,
  dismissible: true,
};

const NOTICE_TOAST_OPTIONS: ExternalToast = {
  duration: 6000,
  closeButton: true,
  dismissible: true,
};

const GlobalFileDropContext = createContext<GlobalFileDropContextValue | null>(
  null
);

/** Each file a picker, drop or paste sends to be made into a card. */
const reportSubmittedFiles = (files: readonly File[]) => {
  for (const file of files) {
    captureEvent("card_create_submitted", {
      card_type:
        inferFileFormat({ fileName: file.name, mimeType: file.type })
          ?.cardType ?? "document",
      source: "web",
      via: "file_upload",
    });
  }
};

export function GlobalFileDropProvider({ children }: { children: ReactNode }) {
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

  const { showCreateFailure } = useUpgradeAction();

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
              ...NOTICE_TOAST_OPTIONS,
              id: TOAST_IDS.uploadQueue,
            }
          );
          return;
        }
        toast.success(t("uploaded", { count: summary.total }), {
          ...SUCCESS_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        });
        return;
      }

      // The card limit first: upgrading is what makes the rest go through.
      const failedWith = (code: string) =>
        summary.failures.find(
          (failure) => !failure.success && failure.errorCode === code
        );
      const limited =
        failedWith(CARD_ERROR_CODES.CARD_LIMIT_REACHED) ??
        failedWith(CARD_ERROR_CODES.RATE_LIMITED);
      if (limited) {
        showCreateFailure(limited, {
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
          note: skippedNote || undefined,
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
            ...MANUAL_CLOSE_TOAST_OPTIONS,
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
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }
      );
    },
    [intlLocale, serverErrors, showCreateFailure, t, tUpload]
  );

  const handlersRef = useRef<UploadQueueHandlers | null>(null);
  useEffect(() => {
    handlersRef.current = {
      onFinish: resolveResultToast,
      onSkipped: (skippedCount) =>
        toast.warning(
          formatSkippedNote(skippedCount, MAX_FILES_PER_UPLOAD, tUpload),
          {
            ...NOTICE_TOAST_OPTIONS,
            id: TOAST_IDS.uploadQueue,
          }
        ),
      onStart: () =>
        toast.loading(t("uploading"), {
          ...LOADING_TOAST_OPTIONS,
          id: TOAST_IDS.uploadQueue,
        }),
      upload: (files) => {
        reportSubmittedFiles(files);
        return uploadMultipleFiles(files);
      },
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
          ...MANUAL_CLOSE_TOAST_OPTIONS,
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
          ...MANUAL_CLOSE_TOAST_OPTIONS,
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
          ...MANUAL_CLOSE_TOAST_OPTIONS,
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
