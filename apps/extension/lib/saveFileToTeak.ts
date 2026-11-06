import { assertUrlStructureSafe } from "@teak/convex/linkMetadata/ssrf";
import { readResponseBlobWithinLimit } from "@teak/convex/shared/boundedResponse";
import { MAX_FILE_SIZE } from "@teak/convex/shared/fileFormats";
import type { UploadedFile } from "teak-sdk";
import type { TeakSaveResponse } from "../types/messages";
import { teakClient } from "./oauthAuth";
import {
  type SaveSource,
  type SaveToTeakDependencies,
  savedResult,
  saveFailure,
} from "./saveToTeak";

const CONTENT_DISPOSITION_FILENAME_REGEX =
  /filename\*?=(?:UTF-8''|")?([^";]+)/iu;

export type { UploadedFile } from "teak-sdk";
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

export const ASSET_REDIRECTED = "ASSET_REDIRECTED";
export const ASSET_IS_PAGE = "ASSET_IS_PAGE";

export const WEB_PAGE_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\b/iu;

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
  const client = dependencies.client ?? teakClient();
  try {
    return savedResult(
      await client.cards.createFromFile(
        {
          bytes: input.bytes,
          content: input.fileName.trim(),
          fileName: input.fileName,
          mimeType: input.mimeType || undefined,
          onUploaded: dependencies.onUploaded,
          uploaded: input.uploaded,
        },
        { idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() }
      )
    );
  } catch (error) {
    return saveFailure(error, "Upload failed");
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
    // A redirect is never followed; it gets its own code so a plain link
    // that redirects can be saved as a link instead.
    const response = await fetchImpl(assetUrl, {
      credentials: "omit",
      redirect: "manual",
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel().catch(() => undefined);
      return errorResponse(
        "The asset could not be downloaded safely.",
        ASSET_REDIRECTED
      );
    }
    // A page that refuses an anonymous fetch (a login wall, a bot check)
    // answers with HTML, which says the link is a page, not a file.
    if (
      !response.ok &&
      WEB_PAGE_TYPE.test(response.headers.get("content-type") ?? "")
    ) {
      await response.body?.cancel().catch(() => undefined);
      return errorResponse(
        "The asset could not be downloaded safely.",
        ASSET_IS_PAGE
      );
    }
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
