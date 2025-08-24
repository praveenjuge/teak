import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useQuery } from "convex/react";
import { api } from "@teak/convex";
import { useFileUpload } from "@teak/shared";
import { toast } from "sonner";

export interface DragDropState {
  isDragActive: boolean;
  isDragAccept: boolean;
  isDragReject: boolean;
  isUploading: boolean;
  uploadProgress: number;
}

export function useGlobalDragDrop() {
  const canCreateCardBasic = useQuery(api.cards.canCreateCard);
  const isSubscribed = useQuery(api.polar.userHasPremium);
  const canCreateCard = !!isSubscribed || !!canCreateCardBasic;

  const { uploadMultipleFiles, state } = useFileUpload({
    onError: (error) => {
      toast.error(error);
    },
  });

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!canCreateCard) {
        toast.error("Card limit reached. Upgrade to Pro for unlimited cards.");
        return;
      }

      if (acceptedFiles.length === 0) {
        toast.error("No valid files to upload");
        return;
      }

      const results = await uploadMultipleFiles(acceptedFiles);

      // Show success/error messages for each file
      results.forEach(result => {
        if (result.success) {
          toast.success(`${result.file} uploaded successfully`);
        } else {
          toast.error(`Failed to upload ${result.file}: ${result.error}`);
        }
      });
    },
    [canCreateCard, uploadMultipleFiles]
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
    disabled: !canCreateCard,
    noClick: true, // Disable click to upload since we have the AddCardForm for that
    noKeyboard: true, // Disable keyboard activation
  });

  const dragDropState: DragDropState = {
    isDragActive,
    isDragAccept,
    isDragReject,
    isUploading: state.isUploading,
    uploadProgress: state.progress,
  };

  return {
    getRootProps,
    getInputProps,
    dragDropState,
    canCreateCard,
  };
}