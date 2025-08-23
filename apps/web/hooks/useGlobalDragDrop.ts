import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "convex/react";
import { api } from "@teak/convex";
import type { CardType } from "@teak/shared/constants";
import { toast } from "sonner";

// File type categorization (reused from AddCardForm)
const getFileCardType = (file: File): CardType => {
  const mimeType = file.type.toLowerCase();

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  return "document";
};

// Get image dimensions (reused from AddCardForm)
const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    img.src = objectUrl;
  });
};

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

          // Upload file with progress tracking
          const xhr = new XMLHttpRequest();
          
          const uploadPromise = new Promise<string>((resolve, reject) => {
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const progress = Math.round((event.loaded / event.total) * 100);
                setUploadProgress(progress);
              }
            };

            xhr.onload = () => {
              if (xhr.status === 200) {
                try {
                  const response = JSON.parse(xhr.responseText);
                  resolve(response.storageId);
                } catch (e) {
                  reject(new Error("Invalid response format"));
                }
              } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error("Upload failed"));
            
            xhr.open("POST", uploadUrl);
            xhr.setRequestHeader("Content-Type", file.type);
            xhr.send(file);
          });

          const storageId = await uploadPromise;

          // Prepare metadata
          const metadata: Record<string, unknown> = {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          };

          // Get image dimensions if it's an image file
          const fileType = getFileCardType(file);
          if (fileType === "image") {
            try {
              const dimensions = await getImageDimensions(file);
              metadata.width = dimensions.width;
              metadata.height = dimensions.height;
            } catch (error) {
              console.warn("Failed to get image dimensions:", error);
            }
          }

          // Create card
          await createCard({
            content: "",
            type: fileType,
            fileId: storageId,
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