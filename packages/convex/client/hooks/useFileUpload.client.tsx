import { useCallback, useState } from "react";
import type { CardErrorCode, CardType } from "../../shared/constants";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
} from "../../shared/constants";
import type {
  UploadFileResult,
  UploadMultipleFilesResultItem,
} from "../../shared/types";

// Sentry capture function - will be injected by platform-specific wrappers
type SentryCaptureFunction = (
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
) => void;
let captureException: SentryCaptureFunction = () => {};

// Best-effort image dimension extraction (browser-only).
// Returns undefined when dimensions cannot be determined or we're in a non-DOM environment.
async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number } | undefined> {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    !file.type?.startsWith("image/")
  ) {
    return undefined;
  }

  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      URL.revokeObjectURL(objectUrl);
      resolve(width && height ? { width, height } : undefined);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(undefined);
    };

    img.src = objectUrl;
  });
}

async function buildAdditionalMetadata(
  file: File,
  metadata?: any
): Promise<any | undefined> {
  // If caller already provided both dimensions, keep them.
  if (metadata?.width && metadata?.height) {
    return metadata;
  }

  const dimensions = await getImageDimensions(file);
  if (dimensions) {
    return { ...dimensions, ...metadata };
  }

  return metadata;
}

function inferCardType(mimeType: string | undefined): CardType | undefined {
  if (!mimeType) return undefined;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("application/msword") ||
    mimeType.startsWith("application/vnd.openxmlformats-officedocument") ||
    mimeType.startsWith("text/")
  ) {
    return "document";
  }
  return undefined;
}

export function setFileUploadSentryCaptureFunction(fn: SentryCaptureFunction) {
  captureException = fn;
}

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
  cardType: CardType;
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
  cardType: CardType;
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
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          const errorInfo: FileUploadError = {
            message: CARD_ERROR_MESSAGES.FILE_TOO_LARGE,
            code: CARD_ERROR_CODES.FILE_TOO_LARGE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        // Attach image dimensions when possible to avoid layout shifts in grids
        const mergedAdditionalMetadata = await buildAdditionalMetadata(
          file,
          options.additionalMetadata
        );

        // Step 1: Get upload URL from Convex
        const cardType = inferCardType(file.type);

        if (!cardType) {
          const errorInfo: FileUploadError = {
            message: "Unsupported file type",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const uploadResult = await uploadAndCreateCard({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          cardType,
          content: options.content,
          additionalMetadata: mergedAdditionalMetadata,
        });

        if (!(uploadResult.success && uploadResult.uploadUrl)) {
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
          headers: { "Content-Type": file.type || "application/octet-stream" },
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
          cardType,
          content: options.content,
          additionalMetadata: mergedAdditionalMetadata,
        });

        if (!(finalizeResult.success && finalizeResult.cardId)) {
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
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
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

        // Capture upload errors in Sentry
        captureException(error, {
          tags: { source: "convex", operation: "fileUpload" },
          extra: {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            errorCode: fileError.code,
          },
        });

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
      // Validate file count
      if (files.length > MAX_FILES_PER_UPLOAD) {
        const errorInfo: FileUploadError = {
          message: CARD_ERROR_MESSAGES.TOO_MANY_FILES,
          code: CARD_ERROR_CODES.TOO_MANY_FILES,
        };
        setError(errorInfo);
        config.onError?.(errorInfo);
        return files.map((file) => ({
          file: file.name,
          success: false as const,
          error: errorInfo.message,
          errorCode: errorInfo.code,
        }));
      }

      const results: UploadMultipleFilesResultItem[] = [];

      for (const file of files) {
        const result = await uploadFile(file, options);
        results.push({ file: file.name, ...result });

        // Small delay between uploads to avoid overwhelming the system
        if (files.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
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
