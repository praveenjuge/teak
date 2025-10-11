import { useState, useCallback } from "react";
import { type CardErrorCode } from "../constants";

export interface UnifiedFileUploadConfig {
  onSuccess?: (cardId: string) => void;
  onError?: (error: FileUploadError) => void;
  onProgress?: (progress: number) => void;
}

export interface FileUploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  errorCode?: CardErrorCode;
}

export interface FileUploadError {
  message: string;
  code?: CardErrorCode;
}

export interface UploadAndCreateCardArgs {
  fileName: string;
  fileType: string;
  fileSize: number;
  content?: string;
  additionalMetadata?: any;
}

export interface UploadAndCreateCardResult {
  success: boolean;
  uploadUrl?: string;
  error?: string;
  errorCode?: CardErrorCode | (string & {});
}

export interface FinalizeUploadedCardArgs {
  fileId: string;
  fileName: string;
  content?: string;
  additionalMetadata?: any;
}

export interface FinalizeUploadedCardResult {
  success: boolean;
  cardId?: string;
  error?: string;
  errorCode?: CardErrorCode | (string & {});
}

export interface FileUploadDependencies {
  uploadAndCreateCard: (
    args: UploadAndCreateCardArgs
  ) => Promise<UploadAndCreateCardResult>;
  finalizeUploadedCard: (
    args: FinalizeUploadedCardArgs
  ) => Promise<FinalizeUploadedCardResult>;
}

type CodedError = Error & { code?: CardErrorCode };

export type UploadFileSuccessResult = {
  success: true;
  cardId: string;
};

export type UploadFileErrorResult = {
  success: false;
  error: string;
  errorCode?: CardErrorCode | (string & {});
};

export type UploadFileResult = UploadFileSuccessResult | UploadFileErrorResult;

export type UploadMultipleFilesResultItem = UploadFileResult & { file: string };

export function useFileUploadCore(
  { uploadAndCreateCard, finalizeUploadedCard }: FileUploadDependencies,
  config: UnifiedFileUploadConfig = {}
) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<FileUploadError | null>(null);

  const uploadFile = useCallback(
    async (
      file: File,
      options: {
        content?: string;
        additionalMetadata?: any;
      } = {}
    ): Promise<UploadFileResult> => {
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
          const errorInfo: FileUploadError = {
            message: uploadResult.error || "Failed to prepare upload",
            code: uploadResult.errorCode as CardErrorCode | undefined,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
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
          const errorInfo: FileUploadError = {
            message: finalizeResult.error || "Failed to create card",
            code: finalizeResult.errorCode as CardErrorCode | undefined,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        config.onProgress?.(100);
        setProgress(100);
        config.onSuccess?.(finalizeResult.cardId);

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Upload failed";
        const fileError: FileUploadError = {
          message: errorMessage,
          code: undefined,
        };

        if (
          error instanceof Error &&
          "code" in error &&
          typeof (error as CodedError).code !== "undefined"
        ) {
          fileError.code = (error as CodedError).code;
        }

        setError(fileError);
        config.onError?.(fileError);
        return {
          success: false,
          error: fileError.message,
          errorCode: fileError.code,
        };
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
    ): Promise<UploadMultipleFilesResultItem[]> => {
      const results: UploadMultipleFilesResultItem[] = [];

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
    error: error?.message ?? null,
    errorCode: error?.code,
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    state,
    // Convenience getters
    isUploading,
    progress,
    error: error?.message ?? null,
    errorCode: error?.code,
  };
}
