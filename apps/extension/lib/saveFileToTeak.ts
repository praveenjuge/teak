import { assertUrlStructureSafe } from "@teak/convex/linkMetadata/ssrf";
import { readResponseBlobWithinLimit } from "@teak/convex/shared/bounded-response";
import {
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  validateFileName,
} from "@teak/convex/shared/file-formats";
import type { TeakSaveResponse } from "../types/messages";
import { api } from "./convex-api";
import {
  type ConvexClientLike,
  getAuthenticatedConvexClient,
  type SaveSource,
  type SaveToTeakDependencies,
} from "./saveToTeak";

const CONTENT_DISPOSITION_FILENAME_REGEX =
  /filename\*?=(?:UTF-8''|")?([^";]+)/iu;

export interface FileUploadInput {
  bytes: Blob;
  fileName: string;
  mimeType?: string;
  source: Extract<SaveSource, "context-menu-asset" | "popup-file">;
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
  dependencies: SaveToTeakDependencies = {}
): Promise<TeakSaveResponse> {
  let fileName: string;
  try {
    fileName = validateFileName(input.fileName);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Invalid file"
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

  let client: ConvexClientLike | null;
  try {
    client = await getAuthenticatedConvexClient(dependencies);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to authenticate"
    );
  }
  if (!client) {
    return { status: "unauthenticated" };
  }

  try {
    const upload = await client.mutation(api.cards.uploadAndCreateCard, {
      cardType: format.cardType,
      fileName,
      fileSize: input.bytes.size,
      fileType: mimeType,
    });
    if (!(upload.success && upload.uploadKey && upload.uploadUrl)) {
      return errorResponse(upload.error || "Failed to prepare upload");
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

    const finalized = await client.mutation(api.cards.finalizeUploadedCard, {
      cardType: format.cardType,
      content: fileName,
      fileKey: upload.uploadKey,
      fileName,
      fileSize: input.bytes.size,
      fileType: mimeType,
    });
    if (!(finalized.success && finalized.cardId)) {
      return errorResponse(finalized.error || "Failed to create card");
    }
    return { cardId: String(finalized.cardId), status: "saved" };
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Upload failed"
    );
  }
}

export async function saveAssetUrlToTeak(
  assetUrl: string,
  dependencies: SaveToTeakDependencies = {}
): Promise<TeakSaveResponse> {
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
    return saveFileToTeak(
      {
        bytes,
        fileName: fileNameFromResponse(response, assetUrl),
        mimeType: response.headers.get("content-type") ?? bytes.type,
        source: "context-menu-asset",
      },
      dependencies
    );
  } catch {
    return errorResponse("The asset could not be downloaded safely.");
  }
}
