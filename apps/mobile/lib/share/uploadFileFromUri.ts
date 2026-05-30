import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import {
  inferCardType,
  type UploadFileFromUriArgs,
} from "@teak/convex/shared/hooks/useFileUpload";
import type { UploadFileResult } from "@teak/convex/shared/types";
import * as FileSystem from "expo-file-system/legacy";

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

async function resolveFileSize(
  fileUri: string,
  providedSize: number | null | undefined
): Promise<number> {
  if (typeof providedSize === "number" && providedSize > 0) {
    return providedSize;
  }

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  const resolvedSize =
    fileInfo.exists && "size" in fileInfo && typeof fileInfo.size === "number"
      ? fileInfo.size
      : 0;

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
    if (!inferCardType(params.mimeType)) {
      return {
        success: false,
        error: "Unsupported file type",
        errorCode: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
      };
    }

    const fileSize = await resolveFileSize(params.fileUri, params.fileSize);

    return dependencies.uploadFromUri({
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
