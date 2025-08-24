import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "convex/react";
import { api } from "@teak/convex";
import { toast } from "sonner";

export interface DragDropState {
  isDragActive: boolean;
  isDragAccept: boolean;
  isDragReject: boolean;
  isUploading: boolean;
  uploadProgress: number;
}

export function useGlobalDragDrop() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const createCard = useMutation(api.cards.createCard);
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);
  const canCreateCardBasic = useQuery(api.cards.canCreateCard);
  const isSubscribed = useQuery(api.polar.userHasPremium);

  const canCreateCard = !!isSubscribed || !!canCreateCardBasic;

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

      // Process files sequentially to avoid overwhelming the system
      for (const file of acceptedFiles) {
        try {
          setIsUploading(true);
          setUploadProgress(0);

          // Generate upload URL
          const uploadUrl = await generateUploadUrl({
            fileName: file.name,
            fileType: file.type,
          });

          // Simple fetch upload (Convex handles the details)
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });

          if (!response.ok) {
            throw new Error(`Upload failed with status ${response.status}`);
          }

          const { storageId } = await response.json();

          // Prepare basic metadata (server will enhance with file details)
          const metadata = {
            fileName: file.name,
          };

          // Create card - server will auto-detect type and extract metadata
          await createCard({
            content: "",
            fileId: storageId as any,
            metadata,
          });

          toast.success(`${file.name} uploaded successfully`);
        } catch (error) {
          console.error("Failed to upload file:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to upload file";
          toast.error(`Failed to upload ${file.name}: ${errorMessage}`);
        }
      }

      setIsUploading(false);
      setUploadProgress(0);
    },
    [createCard, generateUploadUrl, canCreateCard]
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
    isUploading,
    uploadProgress,
  };

  return {
    getRootProps,
    getInputProps,
    dragDropState,
    canCreateCard,
  };
}