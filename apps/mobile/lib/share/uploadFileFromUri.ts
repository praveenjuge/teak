import type { UploadFileResult } from "@teak/convex/shared/types";

const DEFAULT_UPLOAD_FETCH_TIMEOUT_MS = 30_000;

export interface UploadFileFromUriParams {
  additionalMetadata?: Record<string, unknown>;
  content: string;
  fileName: string;
  fileUri: string;
  mimeType: string;
}

export interface UploadFileFromUriDependencies {
  fetchTimeoutMs?: number;
  uploadFile: (
    file: File,
    options?: {
      additionalMetadata?: Record<string, unknown>;
      content?: string;
    }
  ) => Promise<UploadFileResult>;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "File upload failed.";
}

export async function uploadFileFromUri(
  params: UploadFileFromUriParams,
  dependencies: UploadFileFromUriDependencies
): Promise<UploadFileResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      dependencies.fetchTimeoutMs ?? DEFAULT_UPLOAD_FETCH_TIMEOUT_MS
    );

    const response = await fetch(params.fileUri, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to read shared file (${response.status}).`,
      };
    }

    const blob = await response.blob();
    const file = new File([blob], params.fileName, {
      type: params.mimeType,
    });

    return dependencies.uploadFile(file, {
      content: params.content,
      additionalMetadata: params.additionalMetadata,
    });
  } catch (error) {
    return {
      success: false,
      error: normalizeErrorMessage(error),
    };
  }
}
