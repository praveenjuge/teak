import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useFileUpload } from "@/hooks/useFileUpload";
import {
  CARD_ERROR_CODES,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { metrics } from "@/lib/metrics";

export interface DragDropState {
  isDragActive: boolean;
  isDragAccept: boolean;
  isDragReject: boolean;
  isUploading: boolean;
  uploadProgress: number;
  showUpgradePrompt: boolean;
}

export function useGlobalDragDrop() {
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const router = useRouter();

  const { uploadMultipleFiles, state } = useFileUpload({
    onError: (error) => {
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        setShowUpgradePrompt(true);
      } else {
        Sentry.captureException(error, {
          tags: { source: "convex", operation: "dragDropUpload" },
          extra: { errorCode: error.code },
        });
        toast.error(error.message);
      }
    },
  });

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) {
        toast.error("No valid files to upload");
        return;
      }

      const results = await uploadMultipleFiles(acceptedFiles);

      // Track overall drag/drop operation
      const successCount = results.filter((r: UploadMultipleFilesResultItem) => r.success).length;
      const failureCount = results.length - successCount;

      metrics.dragDropPerformed(
        acceptedFiles.length,
        failureCount === 0,
        failureCount > 0 ? "partial_failure" : undefined
      );

      // Show success/error messages for each file
      results.forEach((result: UploadMultipleFilesResultItem) => {
        if (result.success) {
          metrics.cardCreated("file");
          toast.success(`${result.file} uploaded successfully`);
        } else {
          const errorMessage = result.error || "Upload failed";
          if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
            metrics.cardLimitReached(0);
            metrics.upgradePromptShown("drag_drop");
            setShowUpgradePrompt(true);
          } else {
            metrics.errorOccurred("upload", result.errorCode);
            Sentry.captureException(new Error(errorMessage), {
              tags: { source: "convex", operation: "dragDropUpload" },
              extra: { fileName: result.file, errorCode: result.errorCode },
            });
            toast.error(`Failed to upload ${result.file}: ${errorMessage}`);
          }
        }
      });
    },
    [uploadMultipleFiles]
  );

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    onDrop,
    accept: {
      "image/*": [],
      "video/*": [],
      "audio/*": [],
      "application/*": [],
      "text/*": [],
    },
    multiple: true,
    // Remove disabled state - always allow drag and drop optimistically
    noClick: true, // Disable click to upload since we have the AddCardForm for that
    noKeyboard: true, // Disable keyboard activation
  });

  const dragDropState: DragDropState = {
    isDragActive,
    isDragAccept,
    isDragReject,
    isUploading: state.isUploading,
    uploadProgress: state.progress,
    showUpgradePrompt,
  };

  return {
    getRootProps,
    getInputProps,
    dragDropState,
    dismissUpgradePrompt: () => setShowUpgradePrompt(false),
    navigateToUpgrade: () => router.push("/settings"),
  };
}
