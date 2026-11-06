import type {
  FilesExtractArticleParams,
  FilesExtractArticleResult,
} from "./article";
import type {
  FilesCardTypeDecisionParams,
  FilesCardTypeDecisionResult,
  FilesLinkCategoryDecisionParams,
  FilesLinkCategoryDecisionResult,
  FilesRelevanceParams,
  FilesRelevanceResult,
  FilesVisualStylesDecisionParams,
  FilesVisualStylesDecisionResult,
} from "./decisions";
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
import type {
  FilesImportIndexParams,
  FilesImportIndexResult,
  FilesImportMarkdownParams,
  FilesImportMarkdownResult,
} from "./index";
import type { FilesInspectParams, FilesInspectResult } from "./inspect";
import type { FilesLinkCheckParams, FilesLinkCheckResult } from "./linkCheck";
import type { FilesLinkedPdfParams, FilesLinkedPdfResult } from "./linkedPdf";
import type { FilesLinkPageParams, FilesLinkPageResult } from "./linkPage";
import type {
  FilesImageMetadataResult,
  FilesImageTextResult,
  FilesPdfOcrResult,
  FilesTextMetadataOpResult,
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
import type {
  FilesArchivePageParams,
  FilesArchivePageResult,
} from "./pageArchive";
import type {
  FilesRemoteAssetParams,
  FilesRemoteAssetResult,
} from "./remoteAsset";
import type {
  FilesAnimationPaletteParams,
  FilesAnimationPaletteResult,
  FilesCaptureScreenshotParams,
  FilesCaptureScreenshotResult,
  FilesMediaProbeResult,
  FilesPdfThumbnailResult,
  FilesProcessAudioParams,
  FilesProcessAudioResult,
  FilesRenderThumbnailParams,
  FilesVideoFrameParams,
  FilesVideoFrameResult,
} from "./rendering";
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

interface OpTypes<Params, Result> {
  /** Never set: carries the op's params and result types. */
  readonly types?: (params: Params) => Result;
}

interface NetworkOpSpec<Params, Result> extends OpTypes<Params, Result> {
  readonly network: true;
  /** How long Convex waits for the answer; `DEFAULT_OP_TIMEOUT_MS` without. */
  readonly timeoutMs?: number;
}

interface WorkerOpSpec<Params, Result> extends OpTypes<Params, Result> {
  readonly network: false;
}

/** An op Convex sends to the Worker over HTTPS, at `FILES_OP_PATH`. */
const networkOp = <Params, Result>(
  timeoutMs?: number
): NetworkOpSpec<Params, Result> =>
  timeoutMs === undefined ? { network: true } : { network: true, timeoutMs };

/**
 * An op only the Worker's own workflows, queues and crons run, in process.
 * The network route refuses it.
 */
const workerOp = <Params, Result>(): WorkerOpSpec<Params, Result> => ({
  network: false,
});

export const DEFAULT_OP_TIMEOUT_MS = 120_000;

/**
 * Every op, declared once: its params, its result, whether Convex may call
 * it over the network, and how long Convex waits for it. The Worker
 * registers one handler per op (`apps/core-worker/src/ops.ts`); Convex and
 * the Worker's workflows call ops typed by this table.
 */
export const FILES_OP_SPECS = {
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

  "analyze-image": workerOp<FilesSourceKeyParams, FilesImageAnalysisResult>(),
  "archive-page": workerOp<FilesArchivePageParams, FilesArchivePageResult>(),
  "build-export": workerOp<FilesBuildExportParams, FilesBuildExportResult>(),
  "capture-screenshot": workerOp<
    FilesCaptureScreenshotParams,
    FilesCaptureScreenshotResult
  >(),
  "cleanup-stale-pending-uploads": workerOp<
    FilesCleanupPendingUploadsParams,
    FilesCleanupPendingUploadsResult
  >(),
  "decide-card-type": workerOp<
    FilesCardTypeDecisionParams,
    FilesCardTypeDecisionResult
  >(),
  "decide-link-category": workerOp<
    FilesLinkCategoryDecisionParams,
    FilesLinkCategoryDecisionResult
  >(),
  "decide-visual-styles": workerOp<
    FilesVisualStylesDecisionParams,
    FilesVisualStylesDecisionResult
  >(),
  "extract-animation-palette": workerOp<
    FilesAnimationPaletteParams,
    FilesAnimationPaletteResult
  >(),
  "extract-article": workerOp<
    FilesExtractArticleParams,
    FilesExtractArticleResult
  >(),
  "extract-import-files": workerOp<
    FilesExtractImportFilesParams,
    FilesExtractImportFilesResult
  >(),
  "extract-video-frame": workerOp<
    FilesVideoFrameParams,
    FilesVideoFrameResult
  >(),
  "fetch-link-page": workerOp<FilesLinkPageParams, FilesLinkPageResult>(),
  "freeze-object": workerOp<FilesObjectKeyParams, { frozen: boolean }>(),
  "generate-image-metadata": workerOp<
    FilesImageMetadataParams,
    FilesImageMetadataOpResult
  >(),
  "generate-link-metadata": workerOp<
    FilesTextMetadataParams,
    FilesTextMetadataOpResult
  >(),
  "generate-text-metadata": workerOp<
    FilesTextMetadataParams,
    FilesTextMetadataOpResult
  >(),
  "head-object": workerOp<FilesObjectKeyParams, FilesHeadObjectResult>(),
  "index-import-source": workerOp<
    FilesImportIndexParams,
    FilesImportIndexResult
  >(),
  "list-objects": workerOp<FilesListObjectsParams, FilesListObjectsResult>(),
  "ocr-pdf-pages": workerOp<FilesPdfOcrParams, FilesPdfOcrResult>(),
  "probe-media": workerOp<FilesSourceKeyParams, FilesMediaProbeResult>(),
  "process-audio": workerOp<FilesProcessAudioParams, FilesProcessAudioResult>(),
  "read-import-markdown": workerOp<
    FilesImportMarkdownParams,
    FilesImportMarkdownResult
  >(),
  "render-pdf-thumbnail": workerOp<
    FilesRenderThumbnailParams,
    FilesPdfThumbnailResult
  >(),
  "store-remote-asset": workerOp<
    FilesRemoteAssetParams,
    FilesRemoteAssetResult
  >(),
} as const;

type Specs = typeof FILES_OP_SPECS;

export type FilesOp = keyof Specs;

export type FilesNetworkOp = {
  [Op in FilesOp]: Specs[Op]["network"] extends true ? Op : never;
}[FilesOp];

export type FilesWorkerOp = Exclude<FilesOp, FilesNetworkOp>;

/** What an op is sent (for a union of ops, any one of theirs). */
export type FilesOpParams<Op extends FilesOp> = Op extends FilesOp
  ? Specs[Op] extends OpTypes<infer Params, unknown>
    ? Params
    : never
  : never;

/** What an op answers with (for a union of ops, any one of theirs). */
export type FilesOpResult<Op extends FilesOp> = Op extends FilesOp
  ? Specs[Op] extends OpTypes<never, infer Result>
    ? Result
    : never
  : never;
export const FILES_OPS = Object.keys(FILES_OP_SPECS) as FilesOp[];

/** Ops Convex sends to the Worker over HTTPS, at `FILES_OP_PATH`. */
export const FILES_NETWORK_OPS = FILES_OPS.filter(
  (op) => FILES_OP_SPECS[op].network
) as FilesNetworkOp[];

/**
 * Ops only the Worker's own workflows, queues and crons run, in process.
 * The network route refuses them.
 */
export const FILES_WORKER_OPS = FILES_OPS.filter(
  (op) => !FILES_OP_SPECS[op].network
) as FilesWorkerOp[];

export const isFilesOp = (value: unknown): value is FilesOp =>
  typeof value === "string" && (FILES_OPS as readonly string[]).includes(value);

export const isFilesNetworkOp = (value: unknown): value is FilesNetworkOp =>
  isFilesOp(value) && FILES_OP_SPECS[value].network;

/** How long Convex waits for a network op's answer. */
export const filesOpTimeoutMs = (op: FilesNetworkOp): number => {
  const spec: { timeoutMs?: number } = FILES_OP_SPECS[op];
  return spec.timeoutMs ?? DEFAULT_OP_TIMEOUT_MS;
};
