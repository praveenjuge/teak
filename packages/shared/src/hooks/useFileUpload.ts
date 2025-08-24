import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";

export interface UnifiedFileUploadConfig {
  onSuccess?: (cardId: string) => void;
  onError?: (error: string) => void;
  onProgress?: (progress: number) => void;
}

export interface FileUploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
}

export function useFileUpload(config: UnifiedFileUploadConfig = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadAndCreateCard = useMutation(api.cards.uploadAndCreateCard);
  const finalizeUploadedCard = useMutation(api.cards.finalizeUploadedCard);

  const uploadFile = useCallback(
    async (
      file: File,
      options: {
        content?: string;
        additionalMetadata?: any;
      } = {}
    ) => {
      setIsUploading(true);
      setProgress(0);
      setError(null);

      try {
        // Step 1: Get upload URL from Convex
        const uploadResult = await uploadAndCreateCard({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          content: options.content,
          additionalMetadata: options.additionalMetadata,
        });

        if (!uploadResult.success || !uploadResult.uploadUrl) {
          throw new Error(uploadResult.error || "Failed to prepare upload");
        }

        // Step 2: Upload file to Convex storage
        config.onProgress?.(25);
        setProgress(25);

        const uploadResponse = await fetch(uploadResult.uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const { storageId } = await uploadResponse.json();

        config.onProgress?.(75);
        setProgress(75);

        // Step 3: Finalize card creation
        const finalizeResult = await finalizeUploadedCard({
          fileId: storageId,
          fileName: file.name,
          content: options.content,
          additionalMetadata: options.additionalMetadata,
        });

        if (!finalizeResult.success || !finalizeResult.cardId) {
          throw new Error(finalizeResult.error || "Failed to create card");
        }

        config.onProgress?.(100);
        setProgress(100);
        config.onSuccess?.(finalizeResult.cardId);

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Upload failed";
        setError(errorMessage);
        config.onError?.(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsUploading(false);
        // Reset progress after a short delay
        setTimeout(() => setProgress(0), 1000);
      }
    },
    [uploadAndCreateCard, finalizeUploadedCard, config]
  );

  const uploadMultipleFiles = useCallback(
    async (
      files: File[],
      options: {
        content?: string;
        additionalMetadata?: any;
      } = {}
    ) => {
      const results = [];

      for (const file of files) {
        const result = await uploadFile(file, options);
        results.push({ file: file.name, ...result });

        // Small delay between uploads to avoid overwhelming the system
        if (files.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return results;
    },
    [uploadFile]
  );

  const state: FileUploadState = {
    isUploading,
    progress,
    error,
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    state,
    // Convenience getters
    isUploading,
    progress,
    error,
  };
}