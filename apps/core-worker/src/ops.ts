import type { BrowserWorker } from "@cloudflare/puppeteer";
import { CRONS, cronTasksOn } from "@teak/convex/cronSchedules";
import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";
import {
  DISPATCH_ITEM_TYPES,
  FILES_IMPORT_MODES,
  FILES_NETWORK_OPS,
  FILES_OP_MAX_BODY_BYTES,
  FILES_PDF_OCR_MAX_PAGES,
  FILES_PROTOCOL_VERSION,
  FILES_SCREENSHOT_SIZE,
  FILES_UPLOAD_MAX_BYTES,
  type FilesAiGenerationFacts,
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesOp,
  type FilesOpRequest,
  type FilesOpResult,
  filesErrorEnvelope,
  filesSuccessEnvelope,
  isFilesInspectMode,
  isFilesNetworkOp,
  isFilesOp,
  MAINTENANCE_TASKS,
  PAGE_ARCHIVE_SCREENSHOT_MAX_BYTES,
  parseEdgeIdentityPurgeKeys,
  SIGNED_REQUEST_HEADERS,
  VECTOR_DELETE_MAX_IDS,
  verifyFilesOpRequest,
} from "@teak/files-protocol";
import type { AiGatewayEnv, WorkersAiBinding } from "./ai/aiGateway";
import { type AiUsageContext, runWithAiUsage } from "./ai/aiUsage";
import {
  decideCardType,
  decideLinkCategory,
  decideVisualStyles,
  decideVisualStylesForImage,
  scoreRelevance,
} from "./ai/decisions";
import { generateTextMetadataForOp } from "./ai/textMetadata";
import {
  embedUpsert,
  parseEmbedUpsertParams,
  parseVectorIdsParams,
  parseVectorQueryParams,
  parseVectorSimilarParams,
  vectorDelete,
  vectorQuery,
  vectorSimilar,
} from "./ai/vectors";
import { parseArchivePageParams, runArchivePage } from "./archive/archivePage";
import {
  parseExtractArticleParams,
  runExtractArticle,
} from "./archive/article";
import { buildExportIntoBucket } from "./archives/export";
import { indexImportSource, readImportMarkdown } from "./archives/importSource";
import {
  extractZipEntries,
  type InspectRequest,
  runInspect,
} from "./archives/inspect";
import { allowedConvexSiteUrl } from "./convexRpc";
import { finalizeImageUpload } from "./images/finalizeImage";
import { analyzeImage } from "./images/imageAnalysis";
import {
  extractImageTextForOp,
  generateImageMetadataForOp,
  loadImageForAi,
} from "./images/imageMetadata";
import { checkLinkOp } from "./linkCheck";
import {
  captureHtmlScreenshot,
  decodeHtmlParam,
  scrapeHtml,
} from "./media/browserRender";
import {
  type AcquireBrowser,
  createBrowserAcquirer,
} from "./media/browserSessions";
import { parseLinkedPdfParams, storeLinkedPdf } from "./media/linkedPdf";
import { fetchLinkPage, parseLinkPageParams } from "./media/linkPage";
import {
  extractAnimationPalette,
  extractPdfTextViaRenderer,
  extractVideoFrame,
  probeMediaObject,
  processAudio,
  renderPdfPage,
} from "./media/mediaJobs";
import { ocrPdfPages } from "./media/pdfOcr";
import { parseRemoteAssetParams, storeRemoteAsset } from "./media/remoteAsset";
import {
  checkRendererHealth,
  RendererUnavailable,
} from "./media/rendererClient";
import { InvalidOpInput, OpFailure } from "./opFailure";
import {
  derivedKeyParams,
  objectKeyParam,
  optionalDerivedKey,
  optionalString,
  optionalTitle,
  type RawOpParams,
  requiredString,
} from "./opParams";
import {
  abortMultipart,
  cleanupStalePendingUploads,
  completeMultipart,
  createMultipart,
  deleteObject,
  deleteObjects,
  finalizeImageKeys,
  finalizeUpload,
  freezeObjectOp,
  headObject,
  listObjects,
} from "./storage/objectOps";
import {
  parseStoreOnboardingFilesParams,
  storeOnboardingFiles,
} from "./storage/onboardingFiles";
import { reportInternalOpError } from "./telemetry";
import { runDispatch, type WorkflowBindingsEnv } from "./workflows/dispatch";

export const getFilesOpObjectKey = (params: unknown): string => {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "";
  }
  const record = params as Record<string, unknown>;
  const singleKeyParams = [
    "key",
    "sourceKey",
    "archiveKey",
    "artifactKey",
    "manifestKey",
  ];
  for (const name of singleKeyParams) {
    const value = record[name];
    if (typeof value === "string") {
      return value;
    }
  }
  return Array.isArray(record.keys) && typeof record.keys[0] === "string"
    ? record.keys[0]
    : "";
};

export interface FilesOpsEnv extends AiGatewayEnv, WorkflowBindingsEnv {
  AI?: WorkersAiBinding;
  ASSETS?: Fetcher;
  BROWSER?: BrowserWorker;
  BUCKET: R2Bucket;
  CARD_VECTORS_0?: Vectorize;
  EDGE_IDENTITY?: KVNamespace;
  FILES_PUBLIC_ORIGIN?: string;
  FILES_SIGNING_SECRET: string;
  IMAGES?: ImagesBinding;
  LINK_FETCHER?: DurableObjectNamespace;
  LINK_FETCHER_INSTANCES?: string;
  LINK_PAGE_CACHE?: KVNamespace;
  MEDIA_RENDERER?: DurableObjectNamespace;
  MEDIA_RENDERER_INSTANCES?: string;
  OBJECT_GATES?: DurableObjectNamespace;
  POSTHOG_PROJECT_TOKEN?: string;
}

/** An op's envelope and the HTTP status it goes out with. */
export interface FilesOpAnswer<T = unknown> {
  envelope: FilesEnvelope<T>;
  status: number;
}

const fail = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number,
  retryable = false,
  aiFacts?: FilesAiGenerationFacts
): FilesOpAnswer => ({
  envelope: filesErrorEnvelope({
    aiFacts,
    code,
    message,
    requestId,
    retryable,
  }),
  status,
});

export const answerResponse = ({ envelope, status }: FilesOpAnswer): Response =>
  Response.json(envelope, { status, headers: { "cache-control": "no-store" } });

/** What every op handler runs with besides its params. */
interface OpContext {
  ctx?: Pick<ExecutionContext, "waitUntil">;
  env: FilesOpsEnv;
  /**
   * The Worker's own origin, for its signed image URLs. Reading it without
   * one (an in-process call on a Worker without FILES_PUBLIC_ORIGIN) throws.
   */
  readonly origin: string;
  requestId: string;
}

const opContext = ({
  origin,
  ...context
}: Omit<OpContext, "origin"> & { origin: string | undefined }): OpContext => ({
  ...context,
  get origin() {
    if (!origin) {
      throw new Error("files_public_origin_not_configured");
    }
    return origin;
  },
});

/** Reads one op's params, refusing what it can't take, and runs the op. */
type OpHandler<Op extends FilesOp> = (
  params: RawOpParams,
  context: OpContext
) => Promise<FilesOpResult<Op>>;

const MAX_INSPECT_BYTES = 64 * 1024 * 1024;

const readArchiveHtml = async (
  bucket: R2Bucket,
  key: string
): Promise<string> => {
  const object = await bucket.get(key);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  if (object.size > PAGE_ARCHIVE_SCREENSHOT_MAX_BYTES) {
    await object.body.cancel().catch(() => undefined);
    throw new OpFailure("source_too_large");
  }
  return await object.text();
};

const browserAcquirer = (env: FilesOpsEnv): AcquireBrowser => {
  const binding = env.BROWSER;
  if (!binding) {
    throw new RendererUnavailable("browser_binding_missing");
  }
  return async () => {
    const { default: puppeteer } = await import("@cloudflare/puppeteer");
    return await createBrowserAcquirer(puppeteer, binding)();
  };
};

const inspect: OpHandler<"inspect"> = async (params, { env }) => {
  const maxBytes = params.maxBytes;
  const mode = requiredString(params, "mode");
  if (
    !isFilesInspectMode(mode) ||
    typeof maxBytes !== "number" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > (mode === "pdf" ? FILES_UPLOAD_MAX_BYTES : MAX_INSPECT_BYTES)
  ) {
    throw new InvalidOpInput("invalid_inspect_params");
  }
  if (mode === "pdf") {
    return await extractPdfTextViaRenderer(
      env,
      objectKeyParam(params, "sourceKey"),
      maxBytes
    );
  }
  let inspectRequest: InspectRequest;
  if (mode === "zip") {
    inspectRequest = {
      formatId: optionalString(params, "formatId") ?? "",
      mode,
    };
  } else if (mode === "css") {
    inspectRequest = { maxBytes, mode };
  } else {
    inspectRequest = { maxBytes, mode, rtf: params.rtf === true };
  }
  return await runInspect(
    env.BUCKET,
    requiredString(params, "sourceKey"),
    inspectRequest
  );
};

const generateImageMetadata: OpHandler<"generate-image-metadata"> = async (
  params,
  { env, origin, requestId }
) => {
  const title = optionalTitle(params);
  const sourceKey = requiredString(params, "sourceKey");
  const image =
    params.visualStyles === true
      ? await loadImageForAi(env, origin, sourceKey)
      : undefined;
  const [metadata, visualStyles] = await Promise.all([
    generateImageMetadataForOp(env, { image, origin, sourceKey, title }),
    image
      ? decideVisualStylesForImage(env, image, title).catch(
          (error: unknown) => {
            console.warn("[core-worker] visual styles failed", {
              message: error instanceof Error ? error.message : String(error),
              requestId,
            });
            return null;
          }
        )
      : Promise.resolve(null),
  ]);
  return { ...metadata, ...(visualStyles ? { visualStyles } : {}) };
};

const ocrPdf: OpHandler<"ocr-pdf-pages"> = async (params, { env }) => {
  const maxPages = params.maxPages ?? FILES_PDF_OCR_MAX_PAGES;
  if (
    !Number.isInteger(maxPages) ||
    (maxPages as number) < 1 ||
    (maxPages as number) > FILES_PDF_OCR_MAX_PAGES
  ) {
    throw new InvalidOpInput("invalid_max_pages");
  }
  return await ocrPdfPages(
    env,
    requiredString(params, "sourceKey"),
    maxPages as number
  );
};

const captureScreenshot: OpHandler<"capture-screenshot"> = async (
  params,
  { env }
) => {
  const destinationKey = objectKeyParam(params, "destinationKey");
  const acquire = browserAcquirer(env);
  const html =
    params.archiveKey === undefined
      ? await decodeHtmlParam(params.htmlGzipBase64)
      : await readArchiveHtml(env.BUCKET, objectKeyParam(params, "archiveKey"));
  const jpeg = await captureHtmlScreenshot(acquire, html);
  await env.BUCKET.put(destinationKey, jpeg, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return {
    ...FILES_SCREENSHOT_SIZE,
    storedBytes: jpeg.length,
    storedContentType: "image/jpeg",
  };
};

const processAudioOp: OpHandler<"process-audio"> = async (params, { env }) => {
  const mimeType = optionalString(params, "mimeType");
  if (
    typeof params.transcribe !== "boolean" ||
    (mimeType !== null && mimeType.length > 255)
  ) {
    throw new InvalidOpInput("invalid_audio_params");
  }
  return await processAudio(env, {
    mimeType,
    sourceKey: objectKeyParam(params, "sourceKey"),
    transcribe: params.transcribe,
  });
};

/**
 * One handler per op in `FILES_OP_SPECS`; the type makes a missing one a
 * compile error.
 */
const OP_HANDLERS: { [Op in FilesOp]: OpHandler<Op> } = {
  capabilities: async (params, { env }) => ({
    operations: FILES_NETWORK_OPS,
    dispatchItems: DISPATCH_ITEM_TYPES,
    importModes: FILES_IMPORT_MODES,
    crons: cronTasksOn("cloudflare").map((task) => CRONS[task].name),
    maintenanceTasks: MAINTENANCE_TASKS,
    ai: Boolean(env.AI),
    browser: Boolean(env.BROWSER),
    images: Boolean(env.IMAGES),
    renderer: Boolean(env.MEDIA_RENDERER),
    fetcher: Boolean(env.LINK_FETCHER),
    vectors: Boolean(env.CARD_VECTORS_0),
    workflows: Boolean(env.WORKFLOW_RPC_ROOT_SECRET && env.CARD_PROCESSING),
    vectorTypes: true,
    onboardingFiles: Boolean(env.ASSETS),
    ...(params.checkRenderer === true ? await checkRendererHealth(env) : {}),
  }),
  "abort-multipart": (params, { env }) => abortMultipart(env, params),
  "check-link": (params, { env }) => checkLinkOp(env, params),
  "complete-multipart": (params, { env }) => completeMultipart(env, params),
  "create-multipart": (params, { env }) => createMultipart(env, params),
  "delete-object": (params, { env }) => deleteObject(env, params),
  "delete-objects": (params, { env }) => deleteObjects(env, params),
  dispatch: (params, { ctx, env }) => runDispatch(env, params, Date.now(), ctx),
  "embed-upsert": (params, { env }) =>
    embedUpsert(env, parseEmbedUpsertParams(params)),
  "extract-image-text": (params, { env, origin }) =>
    extractImageTextForOp(env, {
      origin,
      sourceKey: requiredString(params, "sourceKey"),
    }),
  "finalize-image-upload": (params, { env, origin }) =>
    finalizeImageUpload(
      env,
      {
        ...finalizeImageKeys(params),
        expectedEtag: optionalString(params, "expectedEtag") ?? undefined,
        expectedSize:
          typeof params.expectedSize === "number"
            ? params.expectedSize
            : undefined,
      },
      origin
    ),
  "finalize-upload": (params, { env }) => finalizeUpload(env, params),
  inspect,
  // Revoked credentials' edge cache entries, so the edge stops treating them
  // as their owner's at once instead of after the cache's five minutes. The
  // development Worker has no edge cache and purges nothing.
  "purge-edge-identity": async (params, { env }) => {
    const keys = parseEdgeIdentityPurgeKeys(params.keys);
    if (!keys) {
      throw new InvalidOpInput("invalid_purge_keys");
    }
    const kv = env.EDGE_IDENTITY;
    if (!kv) {
      return { purged: 0 };
    }
    await Promise.all(keys.map((key) => kv.delete(key)));
    return { purged: keys.length };
  },
  "score-relevance": (params, { env }) => scoreRelevance(env, params),
  "store-linked-pdf": (params, { env }) =>
    storeLinkedPdf(env, parseLinkedPdfParams(params)),
  "store-onboarding-files": (params, { env }) =>
    storeOnboardingFiles(env, parseStoreOnboardingFilesParams(params)),
  "vector-delete": (params, { env }) =>
    vectorDelete(env, parseVectorIdsParams(params, VECTOR_DELETE_MAX_IDS)),
  "vector-query": (params, { env }) =>
    vectorQuery(env, parseVectorQueryParams(params)),
  "vector-similar": (params, { env }) =>
    vectorSimilar(env, parseVectorSimilarParams(params)),

  "analyze-image": (params, { env, origin }) =>
    analyzeImage(env, requiredString(params, "sourceKey"), origin),
  "archive-page": (params, { env }) =>
    runArchivePage(env, parseArchivePageParams(params)),
  "build-export": (params, { env }) =>
    buildExportIntoBucket(
      env.BUCKET,
      requiredString(params, "manifestKey"),
      requiredString(params, "artifactKey"),
      requiredString(params, "fileName")
    ),
  "capture-screenshot": captureScreenshot,
  "cleanup-stale-pending-uploads": (params, { env }) =>
    cleanupStalePendingUploads(env, params),
  "decide-card-type": (params, { env }) => decideCardType(env, params),
  "decide-link-category": (params, { env }) => decideLinkCategory(env, params),
  "decide-visual-styles": (params, { env, origin }) =>
    decideVisualStyles(env, {
      origin,
      sourceKey: requiredString(params, "sourceKey"),
      title: optionalTitle(params),
    }),
  "extract-animation-palette": (params, { env }) =>
    extractAnimationPalette(env, objectKeyParam(params, "sourceKey")),
  "extract-article": (params, { env }) =>
    runExtractArticle(env, parseExtractArticleParams(params)),
  "extract-import-files": (params, { env }) => {
    if (!Array.isArray(params.entries)) {
      throw new InvalidOpInput("invalid_entries");
    }
    return extractZipEntries(
      env.BUCKET,
      requiredString(params, "archiveKey"),
      params.entries,
      optionalString(params, "sourceEtag") ?? undefined
    );
  },
  "extract-video-frame": (params, { env }) => {
    const keys = derivedKeyParams(params);
    return extractVideoFrame(env, {
      ...keys,
      scrubDestinationKey: optionalDerivedKey(
        params,
        "scrubDestinationKey",
        keys
      ),
    });
  },
  "fetch-link-page": (params, { env }) =>
    fetchLinkPage(env, parseLinkPageParams(params), {
      ...(env.BROWSER
        ? {
            scrape: (html: string, selectors: string[]) =>
              scrapeHtml(browserAcquirer(env), html, selectors),
          }
        : {}),
    }),
  "freeze-object": (params, { env }) => freezeObjectOp(env, params),
  "generate-image-metadata": generateImageMetadata,
  "generate-link-metadata": (params, { env }) =>
    generateTextMetadataForOp(env, "generate-link-metadata", params),
  "generate-text-metadata": (params, { env }) =>
    generateTextMetadataForOp(env, "generate-text-metadata", params),
  "head-object": (params, { env }) => headObject(env, params),
  "index-import-source": (params, { env }) =>
    indexImportSource(env.BUCKET, params),
  "list-objects": (params, { env }) => listObjects(env, params),
  "ocr-pdf-pages": ocrPdf,
  "probe-media": (params, { env }) =>
    probeMediaObject(env, objectKeyParam(params, "sourceKey")),
  "process-audio": processAudioOp,
  "read-import-markdown": (params, { env }) =>
    readImportMarkdown(env.BUCKET, params),
  "render-pdf-thumbnail": (params, { env }) =>
    renderPdfPage(env, derivedKeyParams(params)),
  "store-remote-asset": (params, { env }) =>
    storeRemoteAsset(env, parseRemoteAssetParams(params)),
};

/** The network route: a signed op from Convex, one of the network ops. */
export const handleInternalOp = async (
  request: Request,
  env: FilesOpsEnv,
  ctx?: Pick<ExecutionContext, "waitUntil">
): Promise<Response> => {
  const requestId =
    request.headers.get(SIGNED_REQUEST_HEADERS.requestId) ?? "unknown";
  const rawBody = await readResponseTextWithinLimit(
    new Response(request.body),
    FILES_OP_MAX_BODY_BYTES
  );
  if (rawBody === null) {
    return answerResponse(
      fail(
        requestId,
        "PAYLOAD_TOO_LARGE",
        "Operation request exceeds 1 MiB",
        413
      )
    );
  }
  const verification = await verifyFilesOpRequest(
    env.FILES_SIGNING_SECRET,
    request.headers,
    rawBody
  );
  if (!verification.ok) {
    return answerResponse(
      fail(
        requestId,
        verification.code,
        "Request authentication failed",
        verification.status
      )
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return answerResponse(
      fail(requestId, "INVALID_INPUT", "Invalid JSON body", 400)
    );
  }
  const op =
    body && typeof body === "object" ? (body as { op?: unknown }).op : null;
  if (!isFilesNetworkOp(op)) {
    return answerResponse(
      fail(requestId, "UNSUPPORTED", "Unsupported operation", 400)
    );
  }
  return answerResponse(
    await runFilesOp(
      env,
      requestId,
      body as FilesOpRequest,
      new URL(request.url).origin,
      ctx
    )
  );
};

const aiUsageParam = (
  env: FilesOpsEnv,
  value: unknown
): AiUsageContext | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { convexSiteUrl, userId } = value as Record<string, unknown>;
  const origin = allowedConvexSiteUrl(env, convexSiteUrl);
  return origin &&
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.length <= 200
    ? { convexSiteUrl: origin, userId }
    : null;
};

export const runFilesOp = async (
  env: FilesOpsEnv,
  requestId: string,
  body: FilesOpRequest,
  origin: string | undefined,
  ctx?: Pick<ExecutionContext, "waitUntil">
): Promise<FilesOpAnswer> => {
  if (
    !body ||
    typeof body !== "object" ||
    body.version !== FILES_PROTOCOL_VERSION ||
    !isFilesOp(body.op)
  ) {
    return fail(requestId, "UNSUPPORTED", "Unsupported operation", 400);
  }
  if (
    !body.params ||
    typeof body.params !== "object" ||
    Array.isArray(body.params)
  ) {
    return fail(
      requestId,
      "INVALID_INPUT",
      "Invalid operation parameters",
      400
    );
  }
  // Who the op's AI calls count against travels beside its params; the op
  // itself never reads it.
  const { aiUsage, ...params } = body.params as RawOpParams;
  try {
    const handler = OP_HANDLERS[body.op] as OpHandler<FilesOp>;
    const run = async () => ({
      envelope: filesSuccessEnvelope(
        requestId,
        await handler(params, opContext({ ctx, env, origin, requestId }))
      ),
      status: 200,
    });
    const usage = aiUsageParam(env, aiUsage);
    return await (usage ? runWithAiUsage(usage, run) : run());
  } catch (error) {
    if (error instanceof OpFailure) {
      const { code, retryable, status } = error.answer;
      if (code === "RENDERER_UNAVAILABLE") {
        console.warn("[core-worker] renderer unavailable", {
          message: error.message,
          op: body.op,
          requestId,
        });
      }
      return fail(
        requestId,
        code,
        error.message,
        status,
        retryable,
        error.aiFacts
      );
    }
    const message = error instanceof Error ? error.message : "internal_error";
    // Error objects serialize to {} in Workers logs, so log their fields.
    console.error("[core-worker] operation failed", {
      message,
      op: body.op,
      requestId,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await reportInternalOpError(
      env,
      ctx,
      body.op,
      error,
      getFilesOpObjectKey(params)
    );
    return fail(requestId, "INTERNAL", "Internal operation failed", 500, true);
  }
};
