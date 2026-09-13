import {
  FILES_OPS,
  type FilesFinalizeImageParams,
  type FilesFinalizeImageResult,
  type FilesImportIndexParams,
  type FilesImportIndexResult,
  type FilesImportMarkdownParams,
  type FilesImportMarkdownResult,
  type FilesOp,
  type FilesTranscriptParams,
  type FilesTranscriptResult,
} from "./index";

/** Capability feature flags a worker may report as implemented. */
export const FILES_CAPABILITY_FEATURES = [
  "verified-finalization",
  "worker-import-transport",
  "verified-text-reads",
  "media-facts",
  "ai-receipts",
] as const;

export type FilesCapabilityFeature = (typeof FILES_CAPABILITY_FEATURES)[number];

export const isFilesCapabilityFeature = (
  value: unknown
): value is FilesCapabilityFeature =>
  typeof value === "string" &&
  (FILES_CAPABILITY_FEATURES as readonly string[]).includes(value);

export type FilesCapabilitiesParams = Record<string, never>;

export interface FilesCapabilitiesResult {
  ai: boolean;
  features: FilesCapabilityFeature[];
  images: boolean;
  operations: FilesOp[];
  processorVersion: string;
}

export interface FilesAnalyzeImageParams {
  sourceKey: string;
}

export interface FilesAnalyzeImageResult {
  height: number;
  palette: string[];
  width: number;
}

export interface FilesAbortMultipartParams {
  key: string;
  uploadId: string;
}

export interface FilesAbortMultipartResult {
  aborted: true;
}

export interface FilesBuildExportParams {
  artifactKey: string;
  fileName: string;
  manifestKey: string;
}

export interface FilesBuildExportResult {
  artifactBytes: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedPaths: string[];
}

export interface FilesCompleteMultipartParams {
  expectedSize: number;
  key: string;
  parts: Array<{ etag: string; partNumber: number }>;
  uploadId: string;
}

export interface FilesCompleteMultipartResult {
  etag: string;
  key: string;
  size: number;
}

export interface FilesCreateMultipartParams {
  contentType?: string;
  key: string;
}

export interface FilesCreateMultipartResult {
  key: string;
  uploadId: string;
}

export interface FilesDeleteObjectParams {
  key: string;
}

export interface FilesDeleteObjectResult {
  deleted: true;
}

export interface FilesDeleteObjectsParams {
  keys: string[];
}

export interface FilesDeleteObjectsResult {
  deleted: number;
}

export interface FilesExtractImportFilesParams {
  archiveKey: string;
  entries: Array<{
    contentType?: string;
    destinationKey: string;
    path: string;
  }>;
  sourceEtag?: string;
}

export type FilesExtractImportFilesResult = Array<{
  bytes: number;
  destinationKey: string;
  path: string;
}>;

export interface FilesFinalizeUploadParams {
  destinationKey: string;
  expectedEtag?: string;
  expectedSize?: number;
  fileName: string;
  readText?: boolean;
  requestedMimeType?: string;
  sourceKey: string;
}

export type FilesVerificationLevel = "decoded" | "structural" | "claimed";

export interface FilesFinalizeFacts {
  animated?: boolean;
  archiveDirectoryCount?: number;
  archiveFileCount?: number;
  characterCount?: number;
  codec?: string;
  container?: string;
  duration?: number;
  encrypted?: boolean;
  fontFamily?: string;
  fontFormat?: string;
  height?: number;
  lineCount?: number;
  pageCount?: number;
  width?: number;
  wordCount?: number;
}

export interface FilesFinalizeUploadResult {
  content?: string;
  destinationKey: string;
  facts?: FilesFinalizeFacts;
  formatId: string;
  mimeType: string;
  processorVersion: string;
  sourceEtag: string;
  storedEtag: string;
  storedFileSize: number;
  storedMimeType?: string;
  verificationLevel: FilesVerificationLevel;
}

export interface FilesGenerateImageMetadataParams {
  sourceKey: string;
  title?: string;
}

export interface FilesGenerateImageMetadataResult {
  receiptReused?: boolean;
  summary: string;
  tags: string[];
}

export interface FilesHeadObjectParams {
  key: string;
}

export interface FilesHeadObjectResult {
  contentType?: string;
  etag?: string;
  exists: boolean;
  size?: number;
}

export interface FilesInspectParams {
  formatId?: string;
  maxBytes: number;
  mode: "css" | "text" | "zip";
  rtf?: boolean;
  sourceKey: string;
}

export interface FilesInspectResult {
  facts?: Record<string, number>;
  text?: string;
}

export interface FilesListObjectsParams {
  cursor?: string;
  limit?: number;
  prefix: string;
}

export interface FilesListObjectsResult {
  cursor: string | null;
  objects: Array<{ key: string; lastModified: number; size: number }>;
  truncated: boolean;
}

/**
 * Operation-specific parameter maps. Client helpers are generic over
 * `FilesOp` so callers cannot send untyped `Record<string, unknown>`
 * payloads; the worker re-validates every shape at runtime.
 */
export interface FilesOpParams {
  "abort-multipart": FilesAbortMultipartParams;
  "analyze-image": FilesAnalyzeImageParams;
  "analyze-image-content": FilesAnalyzeImageParams;
  "build-export": FilesBuildExportParams;
  capabilities: FilesCapabilitiesParams;
  "complete-multipart": FilesCompleteMultipartParams;
  "create-multipart": FilesCreateMultipartParams;
  "delete-object": FilesDeleteObjectParams;
  "delete-objects": FilesDeleteObjectsParams;
  "extract-import-files": FilesExtractImportFilesParams;
  "finalize-image-upload": FilesFinalizeImageParams;
  "finalize-upload": FilesFinalizeUploadParams;
  "generate-image-metadata": FilesGenerateImageMetadataParams;
  "head-object": FilesHeadObjectParams;
  "index-import-source": FilesImportIndexParams;
  inspect: FilesInspectParams;
  "list-objects": FilesListObjectsParams;
  "read-import-markdown": FilesImportMarkdownParams;
  "transcribe-audio": FilesTranscriptParams;
}

export interface FilesOpResults {
  "abort-multipart": FilesAbortMultipartResult;
  "analyze-image": FilesAnalyzeImageResult;
  "analyze-image-content": FilesAnalyzeImageResult;
  "build-export": FilesBuildExportResult;
  capabilities: FilesCapabilitiesResult;
  "complete-multipart": FilesCompleteMultipartResult;
  "create-multipart": FilesCreateMultipartResult;
  "delete-object": FilesDeleteObjectResult;
  "delete-objects": FilesDeleteObjectsResult;
  "extract-import-files": FilesExtractImportFilesResult;
  "finalize-image-upload": FilesFinalizeImageResult;
  "finalize-upload": FilesFinalizeUploadResult;
  "generate-image-metadata": FilesGenerateImageMetadataResult;
  "head-object": FilesHeadObjectResult;
  "index-import-source": FilesImportIndexResult;
  inspect: FilesInspectResult;
  "list-objects": FilesListObjectsResult;
  "read-import-markdown": FilesImportMarkdownResult;
  "transcribe-audio": FilesTranscriptResult;
}

export interface TypedFilesOpRequest<Op extends FilesOp> {
  op: Op;
  params: FilesOpParams[Op];
  version: 1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0;

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const requiredNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value);

const optionalNumber = (value: unknown): boolean =>
  value === undefined ||
  (typeof value === "number" && Number.isSafeInteger(value));

const optionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean";

const isPartList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 100 &&
  value.every(
    (part) =>
      isRecord(part) &&
      requiredNumber(part.partNumber) &&
      requiredString(part.etag)
  );

const isExtractEntries = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 50 &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      requiredString(entry.path) &&
      requiredString(entry.destinationKey) &&
      (entry.contentType === undefined ||
        (typeof entry.contentType === "string" &&
          entry.contentType.length <= 255))
  );

const validators: {
  [Op in FilesOp]: (params: Record<string, unknown>) => boolean;
} = {
  capabilities: () => true,
  "analyze-image": (params) => requiredString(params.sourceKey),
  "analyze-image-content": (params) => requiredString(params.sourceKey),
  "abort-multipart": (params) =>
    requiredString(params.key) && requiredString(params.uploadId),
  "build-export": (params) =>
    requiredString(params.manifestKey) &&
    requiredString(params.artifactKey) &&
    requiredString(params.fileName),
  "complete-multipart": (params) =>
    requiredString(params.key) &&
    requiredString(params.uploadId) &&
    requiredNumber(params.expectedSize) &&
    (params.expectedSize as number) >= 0 &&
    isPartList(params.parts),
  "create-multipart": (params) =>
    requiredString(params.key) && optionalString(params.contentType),
  "delete-object": (params) => requiredString(params.key),
  "delete-objects": (params) =>
    Array.isArray(params.keys) &&
    params.keys.length > 0 &&
    params.keys.length <= 100 &&
    params.keys.every((key) => requiredString(key)),
  "extract-import-files": (params) =>
    requiredString(params.archiveKey) &&
    isExtractEntries(params.entries) &&
    optionalString(params.sourceEtag),
  "finalize-image-upload": (params) =>
    requiredString(params.sourceKey) &&
    requiredString(params.destinationKey) &&
    optionalString(params.expectedEtag) &&
    optionalNumber(params.expectedSize),
  "finalize-upload": (params) =>
    requiredString(params.sourceKey) &&
    requiredString(params.destinationKey) &&
    requiredString(params.fileName) &&
    (params.fileName as string).length <= 255 &&
    optionalString(params.expectedEtag) &&
    optionalNumber(params.expectedSize) &&
    optionalBoolean(params.readText) &&
    optionalString(params.requestedMimeType),
  "generate-image-metadata": (params) =>
    requiredString(params.sourceKey) &&
    (params.title === undefined ||
      (typeof params.title === "string" && params.title.length <= 2000)),
  "head-object": (params) => requiredString(params.key),
  inspect: (params) =>
    requiredString(params.sourceKey) &&
    (params.mode === "css" ||
      params.mode === "text" ||
      params.mode === "zip") &&
    optionalString(params.formatId) &&
    requiredNumber(params.maxBytes) &&
    (params.maxBytes as number) > 0 &&
    (params.maxBytes as number) <= 64 * 1024 * 1024 &&
    optionalBoolean(params.rtf),
  "list-objects": (params) =>
    requiredString(params.prefix) &&
    !(params.prefix as string).includes("\0") &&
    ((params.prefix as string).startsWith("users/") ||
      (params.prefix as string).startsWith("dev/users/")) &&
    (params.limit === undefined ||
      (requiredNumber(params.limit) &&
        (params.limit as number) > 0 &&
        (params.limit as number) <= 1000)) &&
    (params.cursor === undefined ||
      (typeof params.cursor === "string" && params.cursor.length > 0)),
  "transcribe-audio": (params) =>
    requiredString(params.sourceKey) && optionalString(params.mimeType),
  "index-import-source": (params) =>
    requiredString(params.sourceKey) &&
    requiredNumber(params.expectedSize) &&
    (params.mode === "archive" ||
      params.mode === "bookmarks" ||
      params.mode === "raindrop") &&
    optionalNumber(params.cursor) &&
    optionalString(params.sourceEtag),
  "read-import-markdown": (params) =>
    requiredString(params.sourceKey) &&
    requiredString(params.sourceEtag) &&
    requiredString(params.path),
};

/**
 * Structural runtime check for operation parameters. Accepts every shape
 * the worker accepts and rejects malformed payloads before dispatch; the
 * worker still applies its own key-ownership and namespace checks.
 */
export const isFilesOpParams = (
  op: FilesOp,
  params: unknown
): params is FilesOpParams[FilesOp] => {
  // FILES_OPS is read lazily because index.ts re-exports this module.
  if (!((FILES_OPS as readonly string[]).includes(op) && isRecord(params))) {
    return false;
  }
  return validators[op](params);
};
