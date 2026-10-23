import { captureEvent, resolveSizeBucket } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import type { CardErrorCode, CardType } from "@teak/convex/shared/constants";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  MULTIPART_UPLOAD_THRESHOLD,
} from "@teak/convex/shared/constants";
import {
  inferFileFormat,
  isGenericMimeType,
} from "@teak/convex/shared/fileFormats";
import { normalizeErrorClass } from "@teak/convex/shared/telemetry";
import type {
  UploadFileResult,
  UploadMultipleFilesResultItem,
} from "@teak/convex/shared/types";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AdditionalFileMetadata,
  buildAdditionalFileMetadata,
} from "@/lib/upload/mediaMetadata";
import {
  type MultipartUploadDependencies,
  uploadMultipartFile,
} from "@/lib/upload/multipart";
import {
  type CodedUploadError,
  getUploadEtag,
  isAbortError,
  throwIfAborted,
  uploadAttemptTimeoutMs,
  uploadWithTransientRetry,
} from "@/lib/upload/transport";

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
  additionalMetadata?: AdditionalFileMetadata;
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
  additionalMetadata?: AdditionalFileMetadata;
  cardType: CardType;
  content?: string;
  fileEtag?: string;
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

export interface FileUploadDependencies
  extends Partial<MultipartUploadDependencies> {
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
  }) => Promise<{
    headers?: Headers | Record<string, string>;
    ok: boolean;
    status: number;
  }>;
}

export interface UploadFileFromUriArgs {
  additionalMetadata?: AdditionalFileMetadata;
  content?: string;
  name: string;
  size: number;
  type: string;
  uri: string;
}

const shouldCaptureUploadError = (errorCode?: CardErrorCode) =>
  errorCode !== CARD_ERROR_CODES.FILE_TOO_LARGE;

// A Convex function's ConvexError keeps its code and message in `data`; its
// own message is the serialized data, which isn't fit for a toast.
const toFileUploadError = (error: unknown): FileUploadError => {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown; message?: unknown } | null;
    return {
      code:
        typeof data?.code === "string"
          ? (data.code as CardErrorCode)
          : undefined,
      message:
        typeof data?.message === "string" ? data.message : "Upload failed",
    };
  }
  return {
    code:
      error instanceof Error && "code" in error
        ? (error as CodedUploadError).code
        : undefined,
    message: error instanceof Error ? error.message : "Upload failed",
  };
};

const fileBucket = (mimeType?: string): string => {
  const bucket = mimeType?.split("/", 1)[0] ?? "unknown";
  return ["audio", "image", "text", "video"].includes(bucket)
    ? bucket
    : "document";
};

export function useFileUploadCore(
  {
    completeMultipartUpload,
    uploadAndCreateCard,
    finalizeUploadedCard,
    prepareMultipartUpload,
    recordMultipartPart,
    uploadBinaryFromUri,
  }: FileUploadDependencies,
  config: UnifiedFileUploadConfig = {}
) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<FileUploadError | null>(null);
  const activeUploadAbortRef = useRef<AbortController | null>(null);
  const isUnmountedRef = useRef(false);
  const resetProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      activeUploadAbortRef.current?.abort();
      if (resetProgressTimeoutRef.current) {
        clearTimeout(resetProgressTimeoutRef.current);
      }
    };
  }, []);

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
        additionalMetadata?: AdditionalFileMetadata;
      } = {}
    ): Promise<UploadFileResult> => {
      const abortController = beginUpload();
      const { signal } = abortController;
      setIsUploading(true);
      setProgress(0);
      setError(null);
      const bucket = fileBucket(file.type);

      try {
        if (file.size > MAX_FILE_SIZE) {
          const errorInfo: FileUploadError = {
            message: CARD_ERROR_MESSAGES.FILE_TOO_LARGE,
            code: CARD_ERROR_CODES.FILE_TOO_LARGE,
          };
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const mergedAdditionalMetadata = await buildAdditionalFileMetadata(
          file,
          options.additionalMetadata
        );

        const fileFormat = inferFileFormat({
          fileName: file.name,
          mimeType: file.type,
        });

        if (!fileFormat) {
          const errorInfo: FileUploadError = {
            message: "Unsupported file type",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const cardType = fileFormat.cardType;
        const fileType = isGenericMimeType(file.type)
          ? fileFormat.mimeType
          : file.type;

        let uploadKey: string;
        let fileEtag: string | undefined;
        const canUseMultipart =
          file.size >= MULTIPART_UPLOAD_THRESHOLD &&
          prepareMultipartUpload &&
          recordMultipartPart &&
          completeMultipartUpload;

        if (canUseMultipart) {
          const completed = await uploadMultipartFile({
            dependencies: {
              completeMultipartUpload,
              prepareMultipartUpload,
              recordMultipartPart,
            },
            file,
            fileType,
            onProgress: (nextProgress) => {
              config.onProgress?.(nextProgress);
              setProgress(nextProgress);
            },
            signal,
          });
          uploadKey = completed.uploadKey;
          fileEtag = completed.etag;
        } else {
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
            const codedError = new Error(errorInfo.message) as CodedUploadError;
            codedError.code = errorInfo.code;
            throw codedError;
          }
          uploadKey = uploadResult.uploadKey;
          config.onProgress?.(25);
          setProgress(25);
          const uploadResponse = await uploadWithTransientRetry(
            (attemptSignal) =>
              fetch(uploadResult.uploadUrl as string, {
                method: "PUT",
                headers: { "Content-Type": fileType },
                body: file,
                signal: attemptSignal,
              }),
            signal,
            { timeoutMs: uploadAttemptTimeoutMs(file.size) }
          );
          if (!uploadResponse.ok) {
            throw new Error(
              `Upload failed with status ${uploadResponse.status}`
            );
          }
          fileEtag = getUploadEtag(uploadResponse.headers);
        }

        throwIfAborted(signal);
        config.onProgress?.(75);
        setProgress(75);

        const finalizeResult = await finalizeUploadedCard({
          fileKey: uploadKey,
          fileName: file.name,
          fileSize: file.size,
          fileType,
          fileEtag,
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
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        config.onProgress?.(100);
        setProgress(100);
        config.onSuccess?.(finalizeResult.cardId);
        captureEvent("file_upload_completed", {
          bucket,
          size_bucket: resolveSizeBucket(file.size),
        });

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        if (isAbortError(error)) {
          return { success: false, error: "Upload cancelled" };
        }

        captureEvent("file_upload_failed", {
          bucket,
          error_class: normalizeErrorClass(error),
          size_bucket: resolveSizeBucket(file.size),
        });

        const fileError = toFileUploadError(error);

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
      completeMultipartUpload,
      finalizeUploadedCard,
      prepareMultipartUpload,
      recordMultipartPart,
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
      const bucket = fileBucket(type);

      try {
        if (!uploadBinaryFromUri) {
          const errorInfo: FileUploadError = {
            message: "URI uploads are not supported on this platform",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        if (size > MAX_FILE_SIZE) {
          const errorInfo: FileUploadError = {
            message: CARD_ERROR_MESSAGES.FILE_TOO_LARGE,
            code: CARD_ERROR_CODES.FILE_TOO_LARGE,
          };
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        const fileFormat = inferFileFormat({ fileName: name, mimeType: type });
        if (!fileFormat) {
          const errorInfo: FileUploadError = {
            message: "Unsupported file type",
            code: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
          };
          const codedError = new Error(errorInfo.message) as CodedUploadError;
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
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }
        const { uploadKey, uploadUrl } = uploadResult;

        config.onProgress?.(25);
        setProgress(25);

        const uploadResponse = await uploadWithTransientRetry(
          (attemptSignal) =>
            uploadBinaryFromUri({
              fileUri: uri,
              uploadUrl,
              contentType: fileType,
              signal: attemptSignal,
            }),
          signal,
          { timeoutMs: uploadAttemptTimeoutMs(size) }
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
          fileEtag: getUploadEtag(uploadResponse.headers),
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
          const codedError = new Error(errorInfo.message) as CodedUploadError;
          codedError.code = errorInfo.code;
          throw codedError;
        }

        config.onProgress?.(100);
        setProgress(100);
        config.onSuccess?.(finalizeResult.cardId);
        captureEvent("file_upload_completed", {
          bucket,
          size_bucket: resolveSizeBucket(size),
        });

        return { success: true, cardId: finalizeResult.cardId };
      } catch (error) {
        if (isAbortError(error)) {
          return { success: false, error: "Upload cancelled" };
        }

        captureEvent("file_upload_failed", {
          bucket,
          error_class: normalizeErrorClass(error),
          size_bucket: resolveSizeBucket(size),
        });

        const fileError = toFileUploadError(error);

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
        additionalMetadata?: AdditionalFileMetadata;
      } = {}
    ): Promise<UploadMultipleFilesResultItem[]> => {
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
      // Once the account is out of cards or rate limited, every later file
      // would upload in full only to be refused, so the rest are reported
      // with the same reason instead. Unmounting cancels the rest too.
      let stopped: UploadFileResult | null = null;

      for (const file of files) {
        if (!stopped && isUnmountedRef.current) {
          stopped = { success: false, error: "Upload cancelled" };
        }
        if (stopped) {
          results.push({ file: file.name, ...stopped });
          continue;
        }
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const result = await uploadFile(file, options);
        results.push({ file: file.name, ...result });
        if (
          !result.success &&
          (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED ||
            result.errorCode === CARD_ERROR_CODES.RATE_LIMITED)
        ) {
          stopped = result;
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
    isUploading,
    progress,
    error: error?.message ?? null,
    errorCode: error?.code,
  };
}
