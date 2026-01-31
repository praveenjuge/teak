import * as Sentry from "@sentry/nextjs";
import {
  CARD_ERROR_CODES,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { useCallback } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { useFileUpload } from "@/hooks/useFileUpload";
import { metrics } from "@/lib/metrics";

export function useGlobalDragDrop() {
  const { uploadMultipleFiles } = useFileUpload({
    onError: (error) => {
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        toast.error(
          "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
          {
            action: {
              label: "Upgrade",
              onClick: () => {
                window.location.href = "/settings";
              },
            },
          }
        );
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
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      // Show toast for rejected files
      for (const rejection of fileRejections) {
        const fileName = rejection.file.name;
        const errorMessage =
          rejection.errors[0]?.message || "File type not supported";
        toast.error(`${fileName}: ${errorMessage}`);
      }

      if (acceptedFiles.length === 0) {
        if (fileRejections.length === 0) {
          toast.error("No valid files to upload");
        }
        return;
      }

      // Show loading toasts for each file
      const toastIds: Record<string, string | number> = {};
      for (const file of acceptedFiles) {
        toastIds[file.name] = toast.loading(`Uploading ${file.name}...`);
      }

      const results = await uploadMultipleFiles(acceptedFiles);

      // Track overall drag/drop operation
      const successCount = results.filter(
        (r: UploadMultipleFilesResultItem) => r.success
      ).length;
      const failureCount = results.length - successCount;

      metrics.dragDropPerformed(
        acceptedFiles.length,
        failureCount === 0,
        failureCount > 0 ? "partial_failure" : undefined
      );

      // Show success/error messages for each file
      for (const result of results) {
        const toastId = toastIds[result.file];
        if (result.success) {
          metrics.cardCreated("file");
          toast.success(`${result.file} uploaded successfully`, {
            id: toastId,
          });
        } else {
          const errorMessage = result.error || "Upload failed";
          if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
            metrics.cardLimitReached(0);
            metrics.upgradePromptShown("drag_drop");
            toast.error(
              "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
              {
                id: toastId,
                action: {
                  label: "Upgrade",
                  onClick: () => {
                    window.location.href = "/settings";
                  },
                },
              }
            );
          } else {
            metrics.errorOccurred("upload", result.errorCode);
            Sentry.captureException(new Error(errorMessage), {
              tags: { source: "convex", operation: "dragDropUpload" },
              extra: { fileName: result.file, errorCode: result.errorCode },
            });
            toast.error(`Failed to upload ${result.file}: ${errorMessage}`, {
              id: toastId,
            });
          }
        }
      }
    },
    [uploadMultipleFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [],
      "video/*": [],
      "audio/*": [],
      "application/*": [],
      "text/*": [],
    },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  return {
    getRootProps,
    getInputProps,
    isDragActive,
  };
}
