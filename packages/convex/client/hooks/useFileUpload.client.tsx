import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureClientException,
  runClientSpan,
} from "../../shared/client-telemetry";
import type { CardErrorCode, CardType } from "../../shared/constants";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
} from "../../shared/constants";
import { inferFileFormat, isGenericMimeType } from "../../shared/fileFormats";
import { trackUpload } from "../../shared/metrics";
import type {
  UploadFileResult,
  UploadMultipleFilesResultItem,
} from "../../shared/types";

// Best-effort image dimension extraction (browser-only).
// Returns undefined when dimensions cannot be determined or we're in a non-DOM environment.
function getImageDimensions(
  file: File
): Promise<{ width: number; height: number } | undefined> {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    !file.type?.startsWith("image/")
  ) {
    return Promise.resolve(undefined);
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

export interface UnifiedFileUploadConfig {
  onError?: (error: FileUploadError) => void;
  onProgress?: (progress: number) => void;
  onSuccess?: (cardId: string) => void;
}

export interface FileUploadState {
  error: string | null;
  errorCode?: CardErrorCode;
  isUploading: boolean;
  progress: number;
}

export interface FileUploadError {
  code?: CardErrorCode;
  message: string;
}

export interface UploadAndCreateCardArgs {
  additionalMetadata?: any;
  cardType: CardType;
  content?: string;
  fileName: string;
  fileSize: number;
  fileType: string;
}

export interface UploadAndCreateCardResult {
  error?: string;
  errorCode?: CardErrorCode | (string & {});
  success: boolean;
  uploadKey?: string;
  uploadUrl?: string;
}

export interface FinalizeUploadedCardArgs {
  additionalMetadata?: any;
  cardType: CardType;
  content?: string;
  fileKey: string;
  fileName: string;
  fileSize?: number;
  fileType?: string;
}

export interface FinalizeUploadedCardResult {
  cardId?: string;
  error?: string;
  errorCode?: CardErrorCode | (string & {});
  success: boolean;
}

export interface FileUploadDependencies {
  finalizeUploadedCard: (
    args: FinalizeUploadedCardArgs
  ) => Promise<FinalizeUploadedCardResult>;
  uploadAndCreateCard: (
    args: UploadAndCreateCardArgs
  ) => Promise<UploadAndCreateCardResult>;
  uploadBinaryFromUri?: (args: {
    contentType: string;
    fileUri: string;
    signal: AbortSignal;
    uploadUrl: string;
  }) => Promise<{ ok: boolean; status: number }>;
}

export interface UploadFileFromUriArgs {
  additionalMetadata?: any;
  content?: string;
  name: string;
  size: number;
  type: string;
  uri: string;
}

type CodedError = Error & { code?: CardErrorCode };
type UploadResponse = Pick<Response, "ok" | "status">;

const UPLOAD_RETRY_DELAYS_MS = [300, 900] as const;

const isRetriableUploadStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

const createAbortError = () => {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

const shouldCaptureUploadError = (errorCode?: CardErrorCode) =>
  errorCode !== CARD_ERROR_CODES.FILE_TOO_LARGE;

const fileBucket = (mimeType?: string): string => {
  const bucket = mimeType?.split("/", 1)[0] ?? "unknown";
  return ["audio", "image", "text", "video"].includes(bucket)
    ? bucket
    : "document";
};

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw createAbortError();
  }
};

const sleep = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(createAbortError());
      },
      { once: true }
    );
  });

async function uploadWithTransientRetry(
  upload: () => Promise<UploadResponse>,
  signal: AbortSignal
): Promise<UploadResponse> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= UPLOAD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    throwIfAborted(signal);

    try {
      const response = await upload();
      throwIfAborted(signal);
      if (
        response.ok ||
        !isRetriableUploadStatus(response.status) ||
        attempt === UPLOAD_RETRY_DELAYS_MS.length
      ) {
        return response;
      }
      lastError = new Error(`Upload failed with status ${response.status}`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt === UPLOAD_RETRY_DELAYS_MS.length) {
        throw error;
      }
    }

    await sleep(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
  }

  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

export function useFileUploadCore(
  {
    uploadAndCreateCard,
    finalizeUploadedCard,
    uploadBinaryFromUri,
  }: FileUploadDependencies,
  config: UnifiedFileUploadConfig = {}
) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<FileUploadError | null>(null);
  const activeUploadAbortRef = useRef<AbortController | null>(null);
  const resetProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(
    () => () => {
      activeUploadAbortRef.current?.abort();
      if (resetProgressTimeoutRef.current) {
        clearTimeout(resetProgressTimeoutRef.current);
      }
    },
    []
  );

  const beginUpload = useCallback(() => {
    activeUploadAbortRef.current?.abort();
    if (resetProgressTimeoutRef.current) {
      clearTimeout(resetProgressTimeoutRef.current);
      resetProgressTimeoutRef.current = null;
    }

    const abortController = new AbortController();
    activeUploadAbortRef.current = abortController;
    return abortController;
  }, []);

  const finishUpload = useCallback((abortController: AbortController) => {
    if (activeUploadAbortRef.current !== abortController) {
      return;
    }

    activeUploadAbortRef.current = null;
    setIsUploading(false);

    if (abortController.signal.aborted) {
      setProgress(0);
      return;
    }

    resetProgressTimeoutRef.current = setTimeout(() => {
      setProgress(0);
      resetProgressTimeoutRef.current = null;
    }, 1000);
  }, []);

  const uploadFile = useCallback(
    async (
      file: File,
      options: {
        content?: string;
        additionalMetadata?: any;
      } = {}
    ): Promise<UploadFileResult> => {
      const abortController = beginUpload();
      const { signal } = abortController;
      setIsUploading(true);
      setProgress(0);
      setError(null);
      const startedAt = Date.now();
      const bucket = fileBucket(file.type);
      trackUpload({
        bytes: file.size,
        fileBucket: bucket,
        outcome: "attempt",
        source: "unknown",
      });

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
        const fileFormat = inferFileFormat({
          fileName: file.name,
          mimeType: file.type,
        });

        if (!fileFormat) {
          const errorInfo: FileUploadError = {
            message: "Unsupported file type",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const cardType = fileFormat.cardType;
        const fileType = isGenericMimeType(file.type)
          ? fileFormat.mimeType
          : file.type;

        const uploadResult = await uploadAndCreateCard({
          fileName: file.name,
          fileType,
          fileSize: file.size,
          cardType,
          content: options.content,
          additionalMetadata: mergedAdditionalMetadata,
        });

        if (
          !(
            uploadResult.success &&
            uploadResult.uploadKey &&
            uploadResult.uploadUrl
          )
        ) {
          const errorInfo: FileUploadError = {
            message: uploadResult.error || "Failed to prepare upload",
            code: uploadResult.errorCode as CardErrorCode | undefined,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }
        const { uploadKey, uploadUrl } = uploadResult;

        // Step 2: Upload file to R2
        config.onProgress?.(25);
        setProgress(25);

        const uploadResponse = await runClientSpan(
          {
            attributes: { bytes: file.size, "file.bucket": bucket },
            name: "card.upload",
            operation: "storage.upload",
            stage: "upload",
          },
          () =>
            uploadWithTransientRetry(
              () =>
                fetch(uploadUrl, {
                  method: "PUT",
                  headers: {
                    "Content-Type": fileType,
                  },
                  body: file,
                  signal,
                }),
              signal
            )
        );

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        throwIfAborted(signal);
        config.onProgress?.(75);
        setProgress(75);

        // Step 3: Finalize card creation
        const finalizeResult = await finalizeUploadedCard({
          fileKey: uploadKey,
          fileName: file.name,
          fileSize: file.size,
          fileType,
          cardType,
          content: options.content,
          additionalMetadata: mergedAdditionalMetadata,
        });

        throwIfAborted(signal);
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
        trackUpload({
          bytes: file.size,
          durationMs: Date.now() - startedAt,
          fileBucket: bucket,
          outcome: "success",
          source: "unknown",
        });

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        if (isAbortError(error)) {
          return { success: false, error: "Upload cancelled" };
        }

        trackUpload({
          bytes: file.size,
          durationMs: Date.now() - startedAt,
          fileBucket: bucket,
          outcome: "failure",
          source: "unknown",
        });

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

        if (shouldCaptureUploadError(fileError.code)) {
          captureClientException(error, {
            "error.code": fileError.code,
            "file.bucket": bucket,
            operation: "storage.upload",
          });
        }

        setError(fileError);
        config.onError?.(fileError);
        return {
          success: false,
          error: fileError.message,
          errorCode: fileError.code,
        };
      } finally {
        finishUpload(abortController);
      }
    },
    [
      uploadAndCreateCard,
      finalizeUploadedCard,
      config,
      beginUpload,
      finishUpload,
    ]
  );

  const uploadFileFromUri = useCallback(
    async ({
      uri,
      name,
      type,
      size,
      content,
      additionalMetadata,
    }: UploadFileFromUriArgs): Promise<UploadFileResult> => {
      const abortController = beginUpload();
      const { signal } = abortController;
      setIsUploading(true);
      setProgress(0);
      setError(null);
      const startedAt = Date.now();
      const bucket = fileBucket(type);
      trackUpload({
        bytes: size,
        fileBucket: bucket,
        outcome: "attempt",
        source: "unknown",
      });

      try {
        if (!uploadBinaryFromUri) {
          const errorInfo: FileUploadError = {
            message: "URI uploads are not supported on this platform",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        if (size > MAX_FILE_SIZE) {
          const errorInfo: FileUploadError = {
            message: CARD_ERROR_MESSAGES.FILE_TOO_LARGE,
            code: CARD_ERROR_CODES.FILE_TOO_LARGE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const fileFormat = inferFileFormat({ fileName: name, mimeType: type });
        if (!fileFormat) {
          const errorInfo: FileUploadError = {
            message: "Unsupported file type",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const cardType = fileFormat.cardType;
        const fileType = isGenericMimeType(type) ? fileFormat.mimeType : type;

        const uploadResult = await uploadAndCreateCard({
          fileName: name,
          fileType,
          fileSize: size,
          cardType,
          content,
          additionalMetadata,
        });

        if (
          !(
            uploadResult.success &&
            uploadResult.uploadKey &&
            uploadResult.uploadUrl
          )
        ) {
          const errorInfo: FileUploadError = {
            message: uploadResult.error || "Failed to prepare upload",
            code: uploadResult.errorCode as CardErrorCode | undefined,
          };
          const codedError = new Error(errorInfo.message) as CodedError;
          codedError.code = errorInfo.code;
          throw codedError;
        }
        const { uploadKey, uploadUrl } = uploadResult;

        config.onProgress?.(25);
        setProgress(25);

        const uploadResponse = await runClientSpan(
          {
            attributes: { bytes: size, "file.bucket": bucket },
            name: "card.upload",
            operation: "storage.upload",
            stage: "upload",
          },
          () =>
            uploadWithTransientRetry(
              () =>
                uploadBinaryFromUri({
                  fileUri: uri,
                  uploadUrl,
                  contentType: fileType,
                  signal,
                }),
              signal
            )
        );

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        throwIfAborted(signal);
        config.onProgress?.(75);
        setProgress(75);

        const finalizeResult = await finalizeUploadedCard({
          fileKey: uploadKey,
          fileName: name,
          fileSize: size,
          fileType,
          cardType,
          content,
          additionalMetadata,
        });

        throwIfAborted(signal);
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
        trackUpload({
          bytes: size,
          durationMs: Date.now() - startedAt,
          fileBucket: bucket,
          outcome: "success",
          source: "unknown",
        });

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        if (isAbortError(error)) {
          return { success: false, error: "Upload cancelled" };
        }

        trackUpload({
          bytes: size,
          durationMs: Date.now() - startedAt,
          fileBucket: bucket,
          outcome: "failure",
          source: "unknown",
        });

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

        if (shouldCaptureUploadError(fileError.code)) {
          captureClientException(error, {
            "error.code": fileError.code,
            "file.bucket": bucket,
            operation: "storage.upload",
          });
        }

        setError(fileError);
        config.onError?.(fileError);
        return {
          success: false,
          error: fileError.message,
          errorCode: fileError.code,
        };
      } finally {
        finishUpload(abortController);
      }
    },
    [
      uploadAndCreateCard,
      finalizeUploadedCard,
      uploadBinaryFromUri,
      config,
      beginUpload,
      finishUpload,
    ]
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
    [uploadFile, config.onError]
  );

  const state: FileUploadState = {
    isUploading,
    progress,
    error: error?.message ?? null,
    errorCode: error?.code,
  };

  return {
    uploadFile,
    uploadFileFromUri,
    uploadMultipleFiles,
    state,
    // Convenience getters
    isUploading,
    progress,
    error: error?.message ?? null,
    errorCode: error?.code,
  };
}
