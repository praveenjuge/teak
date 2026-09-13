import { assertUrlStructureSafe } from "@teak/convex/linkMetadata/ssrf";
import {
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  readResponseBlobWithinLimit,
  validateFileName,
} from "@teak/files-core";
import type { TeakSaveResponse } from "../types/messages";
import { oauthRequest } from "./oauthAuth";
import {
  restResult,
  type SaveSource,
  type SaveToTeakDependencies,
} from "./saveToTeak";

const CONTENT_DISPOSITION_FILENAME_REGEX =
  /filename\*?=(?:UTF-8''|")?([^";]+)/iu;

export interface UploadedFile {
  fileEtag?: string;
  fileKey: string;
}
export interface FileUploadDependencies extends SaveToTeakDependencies {
  onUploaded?: (uploaded: UploadedFile) => Promise<void>;
}
export interface FileUploadInput {
  bytes: Blob;
  fileName: string;
  idempotencyKey?: string;
  mimeType?: string;
  source: Extract<SaveSource, "context-menu-asset" | "popup-file">;
  uploaded?: UploadedFile;
}

const errorResponse = (message: string, code?: string): TeakSaveResponse => ({
  code,
  message,
  status: "error",
});

const fileTooLargeResponse = (): TeakSaveResponse =>
  errorResponse(
    `File must be between 1 byte and ${MAX_FILE_SIZE} bytes`,
    "FILE_TOO_LARGE"
  );

export const isSafeDownloadableAssetUrl = (value: string): boolean => {
  try {
    const url = assertUrlStructureSafe(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    return !(
      hostname === "localhost" ||
      hostname === "local" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
};

const fileNameFromResponse = (response: Response, assetUrl: string): string => {
  const disposition = response.headers.get("content-disposition") ?? "";
  const dispositionName =
    CONTENT_DISPOSITION_FILENAME_REGEX.exec(disposition)?.[1];
  if (dispositionName) {
    try {
      return decodeURIComponent(dispositionName.trim());
    } catch {
      return dispositionName.trim();
    }
  }

  const pathName = new URL(assetUrl).pathname.split("/").filter(Boolean).pop();
  if (pathName) {
    try {
      return decodeURIComponent(pathName);
    } catch {
      return pathName;
    }
  }
  return "download";
};

export async function saveFileToTeak(
  input: FileUploadInput,
  dependencies: FileUploadDependencies = {}
): Promise<TeakSaveResponse> {
  let fileName: string;
  try {
    fileName = validateFileName(input.fileName);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid file",
      "INVALID_FILE_NAME"
    );
  }

  if (!(input.bytes.size > 0 && input.bytes.size <= MAX_FILE_SIZE)) {
    return fileTooLargeResponse();
  }

  const format = inferFileFormat({
    fileName,
    mimeType: input.mimeType || input.bytes.type,
  });
  if (!format) {
    return errorResponse("Unsupported file type", "UNSUPPORTED_TYPE");
  }
  const declaredMimeType = input.mimeType || input.bytes.type;
  const mimeType = isGenericMimeType(declaredMimeType)
    ? format.mimeType
    : declaredMimeType;

  const request = dependencies.request ?? oauthRequest;
  try {
    let uploaded = input.uploaded;
    if (!uploaded) {
      const prepared = await request("/v1/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          fileSize: input.bytes.size,
          mimeType,
        }),
      });
      if (!prepared) {
        return { status: "unauthenticated" };
      }
      if (!prepared.ok) {
        return restResult(prepared);
      }
      const upload = await prepared.json();
      if (
        typeof upload.fileKey !== "string" ||
        typeof upload.uploadUrl !== "string"
      ) {
        throw new Error("Invalid upload response.");
      }
      const fetchImpl = dependencies.fetchImpl ?? fetch;
      const uploadResponse = await fetchImpl(upload.uploadUrl, {
        body: input.bytes,
        headers: { "Content-Type": mimeType },
        method: "PUT",
      });
      if (!uploadResponse.ok) {
        return errorResponse(
          `Upload failed with status ${uploadResponse.status}`
        );
      }

      uploaded = {
        fileKey: upload.fileKey,
        fileEtag: uploadResponse.headers.get("etag") ?? undefined,
      };
      await dependencies.onUploaded?.(uploaded);
    }

    return await restResult(
      await request("/v1/cards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey ?? crypto.randomUUID(),
        },
        body: JSON.stringify({
          cardType: format.cardType,
          content: fileName,
          fileKey: uploaded.fileKey,
          fileName,
          fileSize: input.bytes.size,
          mimeType,
          fileEtag: uploaded.fileEtag,
        }),
      })
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Upload failed"
    );
  }
}

export async function downloadAssetFile(
  assetUrl: string,
  dependencies: SaveToTeakDependencies = {}
): Promise<FileUploadInput | TeakSaveResponse> {
  if (!isSafeDownloadableAssetUrl(assetUrl)) {
    return errorResponse(
      "This asset URL cannot be downloaded safely.",
      "UNSAFE_ASSET_URL"
    );
  }

  try {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const response = await fetchImpl(assetUrl, {
      credentials: "omit",
      redirect: "error",
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (
      !response.ok ||
      (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE)
    ) {
      await response.body?.cancel();
      return errorResponse("The asset could not be downloaded safely.");
    }
    const bytes = await readResponseBlobWithinLimit(response, MAX_FILE_SIZE);
    if (!bytes) {
      return fileTooLargeResponse();
    }
    return {
      bytes,
      fileName: fileNameFromResponse(response, assetUrl),
      mimeType: response.headers.get("content-type") ?? bytes.type,
      source: "context-menu-asset",
    };
  } catch {
    return errorResponse("The asset could not be downloaded safely.");
  }
}

export async function saveAssetUrlToTeak(
  assetUrl: string,
  dependencies: SaveToTeakDependencies = {}
): Promise<TeakSaveResponse> {
  const file = await downloadAssetFile(assetUrl, dependencies);
  return "status" in file ? file : saveFileToTeak(file, dependencies);
}
