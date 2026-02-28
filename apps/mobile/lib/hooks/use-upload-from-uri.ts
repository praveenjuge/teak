import { useCallback } from "react";
import { useFileUpload } from "@/lib/hooks/useFileUpload";
import type { ShareUploadResult } from "@/lib/share/types";
import { uploadFileFromUri as uploadFileFromUriHelper } from "@/lib/share/uploadFileFromUri";

export interface UploadFromUriParams {
  additionalMetadata?: Record<string, unknown>;
  content: string;
  fileName: string;
  fileUri: string;
  mimeType: string;
}

interface UploadFromUriError {
  code?: string;
  message: string;
}

interface UseUploadFromUriOptions {
  onError?: (error: UploadFromUriError) => void;
  onSuccess?: () => void;
}

const normalizeError = (error: unknown): UploadFromUriError => {
  if (error instanceof Error) {
    const maybeCode =
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;

    return {
      code: maybeCode,
      message: error.message || "File upload failed.",
    };
  }

  if (typeof error === "object" && error) {
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : "File upload failed.";
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;

    return { code, message };
  }

  return { message: "File upload failed." };
};

export function useUploadFromUri({
  onSuccess,
  onError,
}: UseUploadFromUriOptions = {}) {
  const { uploadFile, state } = useFileUpload({
    onSuccess: () => onSuccess?.(),
  });

  const uploadFromUri = useCallback(
    async ({
      fileUri,
      fileName,
      mimeType,
      content,
      additionalMetadata,
    }: UploadFromUriParams): Promise<ShareUploadResult> => {
      try {
        const result = await uploadFileFromUriHelper(
          {
            fileUri,
            fileName,
            mimeType,
            content,
            additionalMetadata,
          },
          { uploadFile }
        );

        if (!result.success) {
          onError?.({
            code:
              typeof result.errorCode === "string"
                ? result.errorCode
                : undefined,
            message: result.error || "File upload failed.",
          });
        }

        return result;
      } catch (error) {
        const normalizedError = normalizeError(error);
        onError?.(normalizedError);

        return {
          success: false,
          error: normalizedError.message,
          errorCode: normalizedError.code,
        };
      }
    },
    [onError, uploadFile]
  );

  return {
    uploadFromUri,
    uploadState: state,
  };
}
