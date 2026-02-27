import { useCallback } from "react";
import { useFileUpload } from "@/lib/hooks/useFileUpload";

interface UploadFromUriParams {
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
    onError: (error) => onError?.(normalizeError(error)),
    onSuccess: () => onSuccess?.(),
  });

  const uploadFromUri = useCallback(
    async ({
      fileUri,
      fileName,
      mimeType,
      content,
      additionalMetadata,
    }: UploadFromUriParams) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        const response = await fetch(fileUri, { signal: controller.signal });
        clearTimeout(timeoutId);
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: mimeType });

        await uploadFile(file, {
          additionalMetadata,
          content,
        });
      } catch (error) {
        onError?.(normalizeError(error));
      }
    },
    [onError, uploadFile]
  );

  return {
    uploadFromUri,
    uploadState: state,
  };
}
