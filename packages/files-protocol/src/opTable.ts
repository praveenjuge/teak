import type {
  FilesRelevanceParams,
  FilesRelevanceResult,
  FilesVisualStylesDecisionResult,
} from "./decisions";
import type {
  FilesEdgeIdentityPurgeParams,
  FilesEdgeIdentityPurgeResult,
} from "./edgeIdentity";
import type {
  FilesEmbedUpsertParams,
  FilesEmbedUpsertResult,
  FilesVectorDeleteParams,
  FilesVectorDeleteResult,
  FilesVectorQueryParams,
  FilesVectorQueryResult,
  FilesVectorSimilarParams,
  FilesVectorSimilarResult,
} from "./embeddings";
import type { FilesInspectParams, FilesInspectResult } from "./inspect";
import type { FilesLinkCheckParams, FilesLinkCheckResult } from "./linkCheck";
import type { FilesLinkedPdfParams, FilesLinkedPdfResult } from "./linkedPdf";
import type {
  FilesImageMetadataResult,
  FilesImageTextResult,
} from "./metadata";
import type {
  FilesStoreOnboardingFilesParams,
  FilesStoreOnboardingFilesResult,
} from "./onboarding";
import type {
  FilesCapabilities,
  FilesFinalizeImageParams,
  FilesFinalizeImageResult,
} from "./ops";
import type { DispatchParams, DispatchResult } from "./workflows";

/** One object, by its key. */
export interface FilesObjectKeyParams {
  key: string;
}

/** One stored object, by its source key. */
export interface FilesSourceKeyParams {
  sourceKey: string;
}

export interface FilesStoredObject {
  etag: string;
  key: string;
  size: number;
}

export interface FilesCreateMultipartParams {
  contentType?: string;
  key: string;
}

export interface FilesCompleteMultipartParams {
  expectedSize: number;
  key: string;
  parts: Array<{ etag: string; partNumber: number }>;
  uploadId: string;
}

export type FilesHeadObjectResult =
  | { exists: false }
  | { contentType?: string; etag: string; exists: true; size: number };

export interface FilesListObjectsParams {
  cursor?: string | null;
  /** 1 to 1000. */
  limit?: number;
  /** Starts with one of `FILES_USER_KEY_ROOTS`. */
  prefix: string;
}

export interface FilesListObjectsResult {
  cursor: string | null;
  objects: Array<{ key: string; lastModified: number; size: number }>;
  truncated: boolean;
}

export interface FilesCleanupPendingUploadsParams {
  cursor?: string | null;
  /** One of `FILES_USER_KEY_ROOTS`. */
  prefix: string;
}

export interface FilesCleanupPendingUploadsResult {
  cursor: string | null;
  deleted: number;
  pages: number;
}

export interface FilesFinalizeUploadParams {
  destinationKey: string;
  expectedEtag?: string;
  expectedSize?: number;
  /** Also return the object as UTF-8 text. */
  readText?: boolean;
  sourceKey: string;
}

export interface FilesFinalizeUploadResult {
  content?: string;
  destinationKey: string;
  sourceEtag: string;
  storedEtag: string;
  storedFileSize: number;
  storedMimeType?: string;
}

export interface FilesExifFacts {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  make?: string;
  model?: string;
  /** Epoch ms. Without an EXIF offset the camera's local time is read as UTC. */
  takenAt?: number;
  /** The camera's clock time as epoch ms, read as if that clock were UTC. */
  takenAtClock?: number;
  /** Minutes east of UTC from the EXIF offset, when the camera recorded one. */
  takenAtOffset?: number;
}

export interface FilesImageAnalysisResult {
  exif?: FilesExifFacts;
  height: number;
  palette: string[];
  width: number;
}

export interface FilesImageMetadataParams {
  sourceKey: string;
  title?: string;
  /** Also decide the image's visual styles. */
  visualStyles?: boolean;
}

export interface FilesImageMetadataOpResult extends FilesImageMetadataResult {
  visualStyles?: FilesVisualStylesDecisionResult;
}

export interface FilesTextMetadataParams {
  prompt: string;
}

export interface FilesPdfOcrParams {
  /** 1 to `FILES_PDF_OCR_MAX_PAGES`, which it defaults to. */
  maxPages?: number;
  sourceKey: string;
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

export interface FilesImportFileEntry {
  contentType?: string;
  destinationKey: string;
  path: string;
}

export interface FilesExtractImportFilesParams {
  archiveKey: string;
  /** At most 50. */
  entries: FilesImportFileEntry[];
  sourceEtag?: string;
}

export type FilesExtractImportFilesResult = Array<{
  bytes: number;
  destinationKey: string;
  path: string;
}>;

/**
 * The user and deployment an op's Workers AI calls are counted against.
 * Any op may carry it beside its own params; the Worker takes it off
 * before the op reads them.
 */
export interface FilesAiUsageAttribution {
  aiUsage?: { convexSiteUrl: string; userId: string };
}

export interface FilesOpTypes<Params, Result> {
  /** Never set: carries the op's params and result types. */
  readonly types?: (params: Params) => Result;
}

interface NetworkOpSpec<Params, Result> extends FilesOpTypes<Params, Result> {
  /** How long Convex waits for the answer; `DEFAULT_OP_TIMEOUT_MS` without. */
  readonly timeoutMs?: number;
}

const networkOp = <Params, Result>(
  timeoutMs?: number
): NetworkOpSpec<Params, Result> =>
  timeoutMs === undefined ? {} : { timeoutMs };

export const DEFAULT_OP_TIMEOUT_MS = 120_000;

/**
 * Every op Convex sends to the Worker over HTTPS, at `FILES_OP_PATH`,
 * declared once: its params, its result and how long Convex waits for it.
 * The Worker adds the ops only it runs (`apps/core-worker/src/opSpecs.ts`)
 * and registers one handler per op (`apps/core-worker/src/ops.ts`).
 */
export const FILES_NETWORK_OP_SPECS = {
  capabilities: networkOp<{ checkRenderer?: boolean }, FilesCapabilities>(),
  "abort-multipart": networkOp<
    { key: string; uploadId: string },
    { aborted: true }
  >(),
  "check-link": networkOp<FilesLinkCheckParams, FilesLinkCheckResult>(),
  "complete-multipart": networkOp<
    FilesCompleteMultipartParams,
    FilesStoredObject
  >(),
  "create-multipart": networkOp<
    FilesCreateMultipartParams,
    { key: string; uploadId: string }
  >(),
  "delete-object": networkOp<FilesObjectKeyParams, { deleted: true }>(),
  "delete-objects": networkOp<{ keys: string[] }, { deleted: number }>(),
  dispatch: networkOp<DispatchParams, DispatchResult>(60_000),
  "embed-upsert": networkOp<FilesEmbedUpsertParams, FilesEmbedUpsertResult>(
    60_000
  ),
  "extract-image-text": networkOp<FilesSourceKeyParams, FilesImageTextResult>(),
  "finalize-image-upload": networkOp<
    FilesFinalizeImageParams,
    FilesFinalizeImageResult
  >(),
  "finalize-upload": networkOp<
    FilesFinalizeUploadParams,
    FilesFinalizeUploadResult
  >(),
  inspect: networkOp<FilesInspectParams, FilesInspectResult>(),
  "purge-edge-identity": networkOp<
    FilesEdgeIdentityPurgeParams,
    FilesEdgeIdentityPurgeResult
  >(),
  "score-relevance": networkOp<FilesRelevanceParams, FilesRelevanceResult>(),
  "store-linked-pdf": networkOp<FilesLinkedPdfParams, FilesLinkedPdfResult>(
    150_000
  ),
  "store-onboarding-files": networkOp<
    FilesStoreOnboardingFilesParams,
    FilesStoreOnboardingFilesResult
  >(),
  "vector-delete": networkOp<FilesVectorDeleteParams, FilesVectorDeleteResult>(
    30_000
  ),
  "vector-query": networkOp<FilesVectorQueryParams, FilesVectorQueryResult>(
    30_000
  ),
  "vector-similar": networkOp<
    FilesVectorSimilarParams,
    FilesVectorSimilarResult
  >(30_000),
} as const;

export type FilesNetworkOp = keyof typeof FILES_NETWORK_OP_SPECS;

/** What an op of a spec table is sent. */
export type FilesSpecParams<Spec> =
  Spec extends FilesOpTypes<infer Params, unknown> ? Params : never;

/** What an op of a spec table answers with. */
export type FilesSpecResult<Spec> =
  Spec extends FilesOpTypes<never, infer Result> ? Result : never;

/** What a network op is sent (for a union of ops, any one of theirs). */
export type FilesNetworkOpParams<Op extends FilesNetworkOp> = Op extends unknown
  ? FilesSpecParams<(typeof FILES_NETWORK_OP_SPECS)[Op]>
  : never;

/** What a network op answers with (for a union of ops, any one of theirs). */
export type FilesNetworkOpResult<Op extends FilesNetworkOp> = Op extends unknown
  ? FilesSpecResult<(typeof FILES_NETWORK_OP_SPECS)[Op]>
  : never;

export const FILES_NETWORK_OPS = Object.keys(
  FILES_NETWORK_OP_SPECS
) as FilesNetworkOp[];

export const isFilesNetworkOp = (value: unknown): value is FilesNetworkOp =>
  (FILES_NETWORK_OPS as readonly unknown[]).includes(value);

/** How long Convex waits for a network op's answer. */
export const filesOpTimeoutMs = (op: FilesNetworkOp): number => {
  const spec: { timeoutMs?: number } = FILES_NETWORK_OP_SPECS[op];
  return spec.timeoutMs ?? DEFAULT_OP_TIMEOUT_MS;
};
