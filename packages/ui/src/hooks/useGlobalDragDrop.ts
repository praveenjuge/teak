import {
  CARD_ERROR_CODES,
  type UploadMultipleFilesResultItem,
} from "@teak/convex/shared";
import { useCallback } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";
import { toast } from "sonner";

export interface UseGlobalDragDropConfig {
  onUpgrade?: () => void;
  upgradeUrl?: string;
  uploadMultipleFiles: (
    files: File[]
  ) => Promise<UploadMultipleFilesResultItem[]>;
}

export function useGlobalDragDrop({
  uploadMultipleFiles,
  onUpgrade,
  upgradeUrl,
}: UseGlobalDragDropConfig) {
  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
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

      const toastIds: Record<string, string | number> = {};
      for (const file of acceptedFiles) {
        toastIds[file.name] = toast.loading(`Uploading ${file.name}...`);
      }

      const results = await uploadMultipleFiles(acceptedFiles);

      for (const result of results) {
        const toastId = toastIds[result.file];
        if (result.success) {
          toast.success(`${result.file} uploaded successfully`, {
            id: toastId,
          });
        } else {
          const errorMessage = result.error || "Upload failed";
          if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
            const handleUpgrade = () => {
              if (onUpgrade) {
                onUpgrade();
              } else if (upgradeUrl) {
                window.location.href = upgradeUrl;
              }
            };
            toast.error(
              "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
              {
                id: toastId,
                action: {
                  label: "Upgrade",
                  onClick: handleUpgrade,
                },
              }
            );
          } else {
            toast.error(`Failed to upload ${result.file}: ${errorMessage}`, {
              id: toastId,
            });
          }
        }
      }
    },
    [uploadMultipleFiles, onUpgrade, upgradeUrl]
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
