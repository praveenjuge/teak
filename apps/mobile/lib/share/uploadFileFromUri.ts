import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import type { UploadFileFromUriArgs } from "@teak/convex/shared/hooks/useFileUpload";
import type { UploadFileResult } from "@teak/convex/shared/types";
import { getNativeFileSize } from "@/lib/nativeFileSystem";

export interface UploadFileFromUriParams {
  additionalMetadata?: Record<string, unknown>;
  content: string;
  fileName: string;
  fileSize?: number | null;
  fileUri: string;
  mimeType: string;
}

export interface UploadFileFromUriDependencies {
  uploadFromUri: (args: UploadFileFromUriArgs) => Promise<UploadFileResult>;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "File upload failed.";
}

function resolveFileSize(
  fileUri: string,
  providedSize: number | null | undefined
): number {
  if (typeof providedSize === "number" && providedSize > 0) {
    return providedSize;
  }

  const resolvedSize = getNativeFileSize(fileUri);

  if (resolvedSize <= 0) {
    throw new Error("Unable to read shared file size.");
  }

  return resolvedSize;
}

export async function uploadFileFromUri(
  params: UploadFileFromUriParams,
  dependencies: UploadFileFromUriDependencies
): Promise<UploadFileResult> {
  try {
    if (
      !inferFileFormat({
        fileName: params.fileName,
        mimeType: params.mimeType,
      })
    ) {
      return {
        success: false,
        error: "Unsupported file type",
        errorCode: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
      };
    }

    const fileSize = resolveFileSize(params.fileUri, params.fileSize);

    return await dependencies.uploadFromUri({
      uri: params.fileUri,
      name: params.fileName,
      type: params.mimeType,
      size: fileSize,
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
