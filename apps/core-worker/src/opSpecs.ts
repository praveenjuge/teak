import {
  FILES_NETWORK_OP_SPECS,
  type FilesAnimationPaletteParams,
  type FilesAnimationPaletteResult,
  type FilesArchivePageParams,
  type FilesArchivePageResult,
  type FilesBuildExportParams,
  type FilesBuildExportResult,
  type FilesCaptureScreenshotParams,
  type FilesCaptureScreenshotResult,
  type FilesCardTypeDecisionParams,
  type FilesCardTypeDecisionResult,
  type FilesCleanupPendingUploadsParams,
  type FilesCleanupPendingUploadsResult,
  type FilesExtractArticleParams,
  type FilesExtractArticleResult,
  type FilesExtractImportFilesParams,
  type FilesExtractImportFilesResult,
  type FilesHeadObjectResult,
  type FilesImageAnalysisResult,
  type FilesImageMetadataOpResult,
  type FilesImageMetadataParams,
  type FilesImportIndexParams,
  type FilesImportIndexResult,
  type FilesImportMarkdownParams,
  type FilesImportMarkdownResult,
  type FilesLinkCategoryDecisionParams,
  type FilesLinkCategoryDecisionResult,
  type FilesLinkPageParams,
  type FilesLinkPageResult,
  type FilesListObjectsParams,
  type FilesListObjectsResult,
  type FilesMediaProbeResult,
  type FilesObjectKeyParams,
  type FilesOpTypes,
  type FilesPdfOcrParams,
  type FilesPdfOcrResult,
  type FilesPdfThumbnailResult,
  type FilesProcessAudioParams,
  type FilesProcessAudioResult,
  type FilesRemoteAssetParams,
  type FilesRemoteAssetResult,
  type FilesRenderThumbnailParams,
  type FilesSourceKeyParams,
  type FilesSpecParams,
  type FilesSpecResult,
  type FilesTextMetadataOpResult,
  type FilesTextMetadataParams,
  type FilesVideoFrameParams,
  type FilesVideoFrameResult,
  type FilesVisualStylesDecisionParams,
  type FilesVisualStylesDecisionResult,
} from "@teak/files-protocol";

const workerOp = <Params, Result>(): FilesOpTypes<Params, Result> => ({});

/**
 * Ops only the Worker's own workflows, queues and crons run, in process.
 * The network route refuses them, so they are not part of the protocol.
 */
const WORKER_OP_SPECS = {
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

/** Checked in opSpecs.test.ts: none may share a network op's name. */
export const WORKER_OPS = Object.keys(WORKER_OP_SPECS);

const OP_SPECS = { ...FILES_NETWORK_OP_SPECS, ...WORKER_OP_SPECS };

/** Every op the Worker runs: the network ops and its own. */
export type FilesOp = keyof typeof OP_SPECS;

/** What an op is sent (for a union of ops, any one of theirs). */
export type FilesOpParams<Op extends FilesOp> = Op extends unknown
  ? FilesSpecParams<(typeof OP_SPECS)[Op]>
  : never;

/** What an op answers with (for a union of ops, any one of theirs). */
export type FilesOpResult<Op extends FilesOp> = Op extends unknown
  ? FilesSpecResult<(typeof OP_SPECS)[Op]>
  : never;

export const isFilesOp = (value: unknown): value is FilesOp =>
  typeof value === "string" && Object.hasOwn(OP_SPECS, value);
