import { api } from "@teak/convex";
import { useMutation } from "convex/react";

export interface FileUploadConfig {
  onUploadError?: (error: Error) => void;
  onUploadProgress?: (progress: number) => void;
}

export const useCreateCard = () => useMutation(api.cards.createCard);
export const useUpdateCard = () => useMutation(api.cards.updateCardField);
export const usePermanentDeleteCard = () =>
  useMutation(api.cards.permanentDeleteCard);
export const useGenerateUploadUrl = () =>
  useMutation(api.cards.generateUploadUrl);

export function useCreateCardWithFile(config: FileUploadConfig = {}) {
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);
  const createCard = useMutation(api.cards.createCard);

  return {
    async uploadFile(fileUri: string, fileName: string, mimeType: string) {
      try {
        const uploadUrl = await generateUploadUrl({
          fileName,
          fileType: mimeType,
        });

        // Fetch with 30 second timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        const response = await fetch(fileUri, { signal: controller.signal });
        clearTimeout(timeoutId);

        const blob = await response.blob();

        // Upload with 60 second timeout
        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(
          () => uploadController.abort(),
          60_000
        );
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          body: blob,
          signal: uploadController.signal,
        });
        clearTimeout(uploadTimeoutId);

        if (!uploadResponse.ok) {
          throw new Error("Failed to upload file");
        }

        const { storageId } = await uploadResponse.json();
        return storageId;
      } catch (error) {
        config.onUploadError?.(error as Error);
        throw error;
      }
    },
    createCard,
  };
}
