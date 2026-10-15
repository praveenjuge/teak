import type { BrowserWorker } from "@cloudflare/puppeteer";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import { IMPORT_MODES } from "@teak/convex/shared/importSources";
import {
  buildFilesOpSigningPayload,
  FILES_OPS,
  FILES_PROCESSOR_VERSION,
  FILES_PROTOCOL_VERSION,
  FILES_RENDER_MAX_SOURCE_BYTES,
  FILES_SCREENSHOT_SIZE,
  type FilesErrorCode,
  type FilesFinalizeImageParams,
  type FilesOpRequest,
  isFilesInspectMode,
  isFilesOp,
} from "@teak/files-protocol";
import type { AiGatewayEnv, WorkersAiBinding } from "./aiGateway";
import {
  captureHtmlScreenshot,
  decodeHtmlParam,
  scrapeHtml,
  validScrapeSelectors,
} from "./browserRender";
import { type AcquireBrowser, createBrowserAcquirer } from "./browserSessions";
import { freezeObject } from "./deletionGate";
import {
  buildExportIntoBucket,
  ExportManifestInvalid,
  ExportTooLarge,
} from "./export";
import { finalizeImageUpload } from "./finalizeImage";
import { analyzeImage } from "./imageAnalysis";
import { generateImageMetadataForOp } from "./imageMetadata";
import { indexImportSource, readImportMarkdown } from "./importSource";
import { extractZipEntries, InspectSourceMissing, runInspect } from "./inspect";
import { sha256Hex, verifyBodySignature } from "./lib";
import { fetchLinkPage, parseLinkPageParams } from "./linkPage";
import {
  extractAnimationPalette,
  extractPdfTextViaRenderer,
  extractVideoFrame,
  probeMediaObject,
  processAudio,
  renderPdfPage,
} from "./mediaJobs";
import { isMissingMultipartUpload } from "./missingMultipartUpload";
import { parseRemoteAssetParams, storeRemoteAsset } from "./remoteAsset";
import {
  checkRendererHealth,
  RendererDeclined,
  RendererUnavailable,
} from "./rendererClient";
import { reportFilesOpFailure } from "./telemetry";
import {
  generateTextMetadataForOp,
  MetadataCapacityError,
  MetadataValidationError,
} from "./textMetadata";
import { transcribeAudio } from "./transcript";
import { isValidUploadKey } from "./upload";
import { ArchiveEntryTooLargeError } from "./zip";

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

export interface FilesOpsEnv extends AiGatewayEnv {
  AI?: WorkersAiBinding;
  /** Browser Run binding; screenshots and scrapes offline HTML. */
  BROWSER?: BrowserWorker;
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
  /** Images binding; used by finalize-image-upload for decode verification. */
  IMAGES?: ImagesBinding;
  /** Internet-enabled link fetcher Containers; see remoteAsset.ts. */
  LINK_FETCHER?: DurableObjectNamespace;
  LINK_FETCHER_INSTANCES?: string;
  /** fetch-link-page results for a day; see linkPage.ts. */
  LINK_PAGE_CACHE?: KVNamespace;
  /** Media renderer Containers (ffmpeg, poppler); see mediaRenderer.ts. */
  MEDIA_RENDERER?: DurableObjectNamespace;
  MEDIA_RENDERER_INSTANCES?: string;
  OBJECT_GATES?: DurableObjectNamespace;
  /** PostHog project token for error reports; set in production only. */
  POSTHOG_PROJECT_TOKEN?: string;
}

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const fail = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number,
  retryable = false,
  aiFacts?: import("@teak/files-protocol").FilesAiGenerationFacts
): Response =>
  json(
    {
      error: {
        code,
        message,
        requestId,
        retryable,
        ...(aiFacts ? { aiFacts } : {}),
      },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    },
    status
  );

const success = <T>(requestId: string, data: T): Response =>
  json({ data, ok: true, requestId, version: FILES_PROTOCOL_VERSION });

const requiredString = (
  params: Record<string, unknown>,
  key: string
): string => {
  const value = params[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`invalid_${key}`);
  }
  return value;
};

const optionalString = (
  params: Record<string, unknown>,
  key: string
): string | null => {
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

const stripDevPrefix = (key: string): string =>
  key.startsWith("dev/") ? key.slice(4) : key;

const sameUserNamespace = (left: string, right: string): boolean => {
  const leftParts = stripDevPrefix(left).split("/");
  const rightParts = stripDevPrefix(right).split("/");
  return (
    leftParts[0] === "users" &&
    rightParts[0] === "users" &&
    leftParts[1] === rightParts[1]
  );
};

const finalizeUpload = async (
  bucket: R2Bucket,
  params: Record<string, unknown>
) => {
  const sourceKey = requiredString(params, "sourceKey");
  const destinationKey = requiredString(params, "destinationKey");
  if (!sameUserNamespace(sourceKey, destinationKey)) {
    throw new Error("invalid_storage_key");
  }
  const source = await bucket.get(sourceKey);
  if (!source) {
    throw new InspectSourceMissing();
  }
  const expectedEtag = optionalString(params, "expectedEtag");
  const expectedSize = params.expectedSize;
  if (
    (expectedEtag && source.httpEtag !== expectedEtag) ||
    (typeof expectedSize === "number" && source.size !== expectedSize)
  ) {
    await source.body.cancel();
    throw new Error("source_changed");
  }
  let content: string | undefined;
  let body: ReadableStream | Uint8Array = source.body;
  if (params.readText === true) {
    const bytes = new Uint8Array(await source.arrayBuffer());
    body = bytes;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new Error("invalid_utf8");
    }
  }
  const stored = await bucket.put(destinationKey, body, {
    httpMetadata: source.httpMetadata,
    customMetadata: {
      ...source.customMetadata,
      processorVersion: FILES_PROCESSOR_VERSION,
      sourceEtag: source.httpEtag,
    },
  });
  return {
    content,
    destinationKey,
    sourceEtag: source.httpEtag,
    storedEtag: stored.httpEtag,
    storedFileSize: source.size,
    storedMimeType: source.httpMetadata?.contentType,
  };
};

/** Source and destination of a derived image, both in one user namespace. */
const derivedImageKeys = (params: Record<string, unknown>) => {
  const sourceKey = requiredString(params, "sourceKey");
  const destinationKey = requiredString(params, "destinationKey");
  if (
    !(
      isValidUploadKey(sourceKey) &&
      isValidUploadKey(destinationKey) &&
      sameUserNamespace(sourceKey, destinationKey)
    ) ||
    sourceKey === destinationKey
  ) {
    throw new Error("invalid_storage_key");
  }
  return { destinationKey, sourceKey };
};

/** An optional second output (a scrub sprite) beside a derived image. */
const optionalDerivedKey = (
  params: Record<string, unknown>,
  name: string,
  keys: { destinationKey: string; sourceKey: string }
): string | null => {
  const value = params[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !isValidUploadKey(value) ||
    !sameUserNamespace(keys.sourceKey, value) ||
    value === keys.sourceKey ||
    value === keys.destinationKey
  ) {
    throw new Error("invalid_storage_key");
  }
  return value;
};

const validSourceKey = (params: Record<string, unknown>): string => {
  const sourceKey = requiredString(params, "sourceKey");
  if (!isValidUploadKey(sourceKey)) {
    throw new Error("invalid_storage_key");
  }
  return sourceKey;
};

const MAX_INSPECT_BYTES = 64 * 1024 * 1024;

const validDestinationKey = (params: Record<string, unknown>): string => {
  const destinationKey = requiredString(params, "destinationKey");
  if (!isValidUploadKey(destinationKey)) {
    throw new Error("invalid_storage_key");
  }
  return destinationKey;
};

const browserAcquirer = (env: FilesOpsEnv): AcquireBrowser => {
  const binding = env.BROWSER;
  if (!binding) {
    throw new RendererUnavailable("browser_binding_missing");
  }
  return async () => {
    // Loaded on first use so other operations never pay its startup cost.
    const { default: puppeteer } = await import("@cloudflare/puppeteer");
    return await createBrowserAcquirer(puppeteer, binding)();
  };
};

const validKeyList = (value: unknown): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some((key) => typeof key !== "string" || !isValidUploadKey(key))
  ) {
    throw new Error("invalid_keys");
  }
  // Object keys are immutable per-card paths; reject duplicates so a single
  // batch never double-deletes across namespaces.
  return Array.from(new Set(value as string[]));
};

const PENDING_UPLOAD_CARD_ID = "upload-pending-v2";
const PENDING_UPLOAD_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const CLEANUP_LIST_PAGE_SIZE = 1000;
const CLEANUP_MAX_PAGES = 10;
const CLEANUP_DELETE_BATCH_SIZE = 100;

const dispatch = async (
  env: FilesOpsEnv,
  requestId: string,
  body: FilesOpRequest,
  origin: string
): Promise<Response> => {
  const params = (body.params ?? {}) as Record<string, unknown>;
  switch (body.op) {
    case "capabilities":
      return success(requestId, {
        operations: FILES_OPS,
        // Import sources index-import-source reads; the deploy gate checks
        // the backend's are all here before Convex ships a new one.
        importModes: IMPORT_MODES,
        ai: Boolean(env.AI),
        browser: Boolean(env.BROWSER),
        images: Boolean(env.IMAGES),
        renderer: Boolean(env.MEDIA_RENDERER),
        fetcher: Boolean(env.LINK_FETCHER),
        // Starts a renderer when none is warm, so only deploy gates ask.
        ...(params.checkRenderer === true
          ? await checkRendererHealth(env)
          : {}),
      });
    case "index-import-source":
      return success(requestId, await indexImportSource(env.BUCKET, params));
    case "read-import-markdown":
      return success(requestId, await readImportMarkdown(env.BUCKET, params));
    case "transcribe-audio":
      return success(requestId, await transcribeAudio(env, params));
    case "analyze-image":
    case "analyze-image-content":
      return success(
        requestId,
        await analyzeImage(env, requiredString(params, "sourceKey"), origin)
      );
    case "inspect": {
      const maxBytes = params.maxBytes;
      const mode = requiredString(params, "mode");
      if (
        !isFilesInspectMode(mode) ||
        typeof maxBytes !== "number" ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        maxBytes >
          (mode === "pdf" ? FILES_RENDER_MAX_SOURCE_BYTES : MAX_INSPECT_BYTES)
      ) {
        throw new Error("invalid_inspect_params");
      }
      if (mode === "pdf") {
        return success(
          requestId,
          await extractPdfTextViaRenderer(env, validSourceKey(params), maxBytes)
        );
      }
      return success(
        requestId,
        await runInspect(
          env.BUCKET,
          requiredString(params, "sourceKey"),
          mode,
          optionalString(params, "formatId") ?? "",
          maxBytes,
          params.rtf === true
        )
      );
    }
    case "build-export":
      return success(
        requestId,
        await buildExportIntoBucket(
          env.BUCKET,
          requiredString(params, "manifestKey"),
          requiredString(params, "artifactKey"),
          requiredString(params, "fileName")
        )
      );
    case "create-multipart": {
      const upload = await env.BUCKET.createMultipartUpload(
        requiredString(params, "key"),
        {
          httpMetadata: {
            contentType:
              optionalString(params, "contentType") ??
              "application/octet-stream",
          },
        }
      );
      return success(requestId, { key: upload.key, uploadId: upload.uploadId });
    }
    case "complete-multipart": {
      const parts = params.parts;
      const expectedSize = params.expectedSize;
      if (
        !Array.isArray(parts) ||
        parts.length === 0 ||
        parts.length > 100 ||
        typeof expectedSize !== "number" ||
        !Number.isSafeInteger(expectedSize) ||
        expectedSize < 0
      ) {
        throw new Error("invalid_parts");
      }
      const existing = await env.BUCKET.head(requiredString(params, "key"));
      if (existing) {
        if (existing.size !== expectedSize) {
          throw new Error("source_changed");
        }
        return success(requestId, {
          etag: existing.httpEtag,
          key: existing.key,
          size: existing.size,
        });
      }
      const upload = env.BUCKET.resumeMultipartUpload(
        requiredString(params, "key"),
        requiredString(params, "uploadId")
      );
      const object = await upload.complete(
        parts.map((part) => {
          const value = part as Record<string, unknown>;
          if (
            typeof value.partNumber !== "number" ||
            typeof value.etag !== "string"
          ) {
            throw new Error("invalid_part");
          }
          return { partNumber: value.partNumber, etag: value.etag };
        })
      );
      return success(requestId, {
        etag: object.httpEtag,
        key: object.key,
        size: object.size,
      });
    }
    case "freeze-object": {
      const key = requiredString(params, "key");
      if (!isValidUploadKey(key)) {
        throw new Error("invalid_storage_key");
      }
      return success(requestId, { frozen: await freezeObject(env, key) });
    }
    case "abort-multipart": {
      const key = requiredString(params, "key");
      if (!isValidUploadKey(key)) {
        throw new Error("invalid_storage_key");
      }
      try {
        await env.BUCKET.resumeMultipartUpload(
          key,
          requiredString(params, "uploadId")
        ).abort();
      } catch (error) {
        // R2 NoSuchUpload means this idempotent cleanup has already completed.
        // All other errors must propagate to durable workflow/cron retries.
        if (!isMissingMultipartUpload(error)) {
          throw error;
        }
      }
      return success(requestId, { aborted: true });
    }
    case "finalize-upload":
      return success(requestId, await finalizeUpload(env.BUCKET, params));
    case "finalize-image-upload": {
      const sourceKey = requiredString(params, "sourceKey");
      const destinationKey = requiredString(params, "destinationKey");
      if (!sameUserNamespace(sourceKey, destinationKey)) {
        throw new Error("invalid_storage_key");
      }
      const finalization = {
        destinationKey,
        expectedEtag: optionalString(params, "expectedEtag") ?? undefined,
        expectedSize:
          typeof params.expectedSize === "number"
            ? params.expectedSize
            : undefined,
        sourceKey,
      } satisfies FilesFinalizeImageParams;
      return success(
        requestId,
        await finalizeImageUpload(env, finalization, origin)
      );
    }
    case "cleanup-stale-pending-uploads": {
      const prefix = requiredString(params, "prefix");
      if (!(prefix === "users/" || prefix === "dev/users/")) {
        throw new Error("invalid_cleanup_params");
      }
      let cursor = optionalString(params, "cursor");
      let deleted = 0;
      let pages = 0;
      const staleBefore = Date.now() - PENDING_UPLOAD_STALE_AFTER_MS;
      const pendingSegment = `/cards/${PENDING_UPLOAD_CARD_ID}/`;
      do {
        const listed = await env.BUCKET.list({
          prefix,
          ...(cursor ? { cursor } : {}),
          limit: CLEANUP_LIST_PAGE_SIZE,
        });
        const staleKeys = listed.objects.flatMap((object) =>
          object.key.includes(pendingSegment) &&
          object.uploaded.getTime() <= staleBefore
            ? [object.key]
            : []
        );
        for (
          let index = 0;
          index < staleKeys.length;
          index += CLEANUP_DELETE_BATCH_SIZE
        ) {
          await env.BUCKET.delete(
            staleKeys.slice(index, index + CLEANUP_DELETE_BATCH_SIZE)
          );
        }
        deleted += staleKeys.length;
        pages += 1;
        cursor = listed.truncated ? (listed.cursor ?? null) : null;
      } while (cursor && pages < CLEANUP_MAX_PAGES);
      return success(requestId, {
        cursor,
        deleted,
        pages,
      });
    }
    case "delete-object":
      await env.BUCKET.delete(requiredString(params, "key"));
      return success(requestId, { deleted: true });
    case "delete-objects": {
      const keys = validKeyList(params.keys);
      // R2 treats missing objects as success for batch deletes.
      await env.BUCKET.delete(keys);
      return success(requestId, { deleted: keys.length });
    }
    case "head-object": {
      const key = requiredString(params, "key");
      if (!isValidUploadKey(key)) {
        throw new Error("invalid_storage_key");
      }
      const object = await env.BUCKET.head(key);
      if (!object) {
        return success(requestId, { exists: false });
      }
      return success(requestId, {
        contentType: object.httpMetadata?.contentType,
        etag: object.httpEtag,
        exists: true,
        size: object.size,
      });
    }
    case "list-objects": {
      const prefix = requiredString(params, "prefix");
      if (
        !(prefix.startsWith("users/") || prefix.startsWith("dev/users/")) ||
        prefix.includes("\0")
      ) {
        throw new Error("invalid_prefix");
      }
      const limit = params.limit;
      if (
        limit !== undefined &&
        (typeof limit !== "number" ||
          !Number.isSafeInteger(limit) ||
          limit <= 0 ||
          limit > 1000)
      ) {
        throw new Error("invalid_limit");
      }
      const cursor = optionalString(params, "cursor");
      const listed = await env.BUCKET.list({
        prefix,
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      });
      return success(requestId, {
        cursor: listed.truncated ? (listed.cursor ?? null) : null,
        objects: listed.objects.map((object) => ({
          key: object.key,
          lastModified: object.uploaded.getTime(),
          size: object.size,
        })),
        truncated: listed.truncated,
      });
    }
    case "generate-text-metadata":
    case "generate-link-metadata":
      return success(
        requestId,
        await generateTextMetadataForOp(env, body.op, params)
      );
    case "generate-image-metadata": {
      const title = optionalString(params, "title");
      if (title !== null && title.length > 2000) {
        throw new Error("invalid_title");
      }
      return success(
        requestId,
        await generateImageMetadataForOp(env, {
          origin,
          sourceKey: requiredString(params, "sourceKey"),
          title,
        })
      );
    }
    case "render-pdf-thumbnail":
      return success(
        requestId,
        await renderPdfPage(env, derivedImageKeys(params))
      );
    case "extract-video-frame": {
      const keys = derivedImageKeys(params);
      return success(
        requestId,
        await extractVideoFrame(env, {
          ...keys,
          scrubDestinationKey: optionalDerivedKey(
            params,
            "scrubDestinationKey",
            keys
          ),
        })
      );
    }
    case "capture-screenshot": {
      const destinationKey = validDestinationKey(params);
      const acquire = browserAcquirer(env);
      const html = await decodeHtmlParam(params.htmlGzipBase64);
      const jpeg = await captureHtmlScreenshot(acquire, html);
      await env.BUCKET.put(destinationKey, jpeg, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      return success(requestId, {
        ...FILES_SCREENSHOT_SIZE,
        storedBytes: jpeg.length,
        storedContentType: "image/jpeg",
      });
    }
    case "store-remote-asset":
      return success(
        requestId,
        await storeRemoteAsset(env, parseRemoteAssetParams(params))
      );
    case "fetch-link-page":
      return success(
        requestId,
        await fetchLinkPage(env, parseLinkPageParams(params), {
          // Without a browser the static result stands, as when Browser Run
          // declines.
          ...(env.BROWSER
            ? {
                scrape: (html: string, selectors: string[]) =>
                  scrapeHtml(browserAcquirer(env), html, selectors),
              }
            : {}),
        })
      );
    case "scrape-html": {
      const selectors = validScrapeSelectors(params.selectors);
      const acquire = browserAcquirer(env);
      const html = await decodeHtmlParam(params.htmlGzipBase64);
      return success(requestId, await scrapeHtml(acquire, html, selectors));
    }
    case "probe-media":
      return success(
        requestId,
        await probeMediaObject(env, validSourceKey(params))
      );
    case "extract-animation-palette":
      return success(
        requestId,
        await extractAnimationPalette(env, validSourceKey(params))
      );
    case "process-audio": {
      const mimeType = optionalString(params, "mimeType");
      if (
        typeof params.transcribe !== "boolean" ||
        (mimeType !== null && mimeType.length > 255)
      ) {
        throw new Error("invalid_audio_params");
      }
      return success(
        requestId,
        await processAudio(env, {
          mimeType,
          sourceKey: validSourceKey(params),
          transcribe: params.transcribe,
        })
      );
    }
    case "extract-import-files": {
      if (!Array.isArray(params.entries)) {
        throw new Error("invalid_entries");
      }
      return success(
        requestId,
        await extractZipEntries(
          env.BUCKET,
          requiredString(params, "archiveKey"),
          params.entries,
          optionalString(params, "sourceEtag") ?? undefined
        )
      );
    }
    default:
      throw new Error("invalid_operation");
  }
};

export const handleInternalOp = async (
  request: Request,
  env: FilesOpsEnv,
  ctx?: Pick<ExecutionContext, "waitUntil">
): Promise<Response> => {
  const requestId = request.headers.get("x-teak-request-id") ?? "unknown";
  const rawBody = await readResponseTextWithinLimit(
    new Response(request.body),
    1024 * 1024
  );
  if (rawBody === null) {
    return fail(
      requestId,
      "PAYLOAD_TOO_LARGE",
      "Operation request exceeds 1 MiB",
      413
    );
  }
  const bodySha256 = await sha256Hex(rawBody);
  const verification = await verifyBodySignature(
    env.FILES_SIGNING_SECRET,
    {
      bodySha256,
      expiresAt: request.headers.get("x-teak-expires-at"),
      requestId,
      signature: request.headers.get("x-teak-signature"),
    },
    buildFilesOpSigningPayload
  );
  if (!verification.ok) {
    return fail(
      requestId,
      verification.status === 410 ? "AUTH_EXPIRED" : "AUTH_INVALID",
      "Request authentication failed",
      verification.status
    );
  }
  let body: FilesOpRequest;
  try {
    body = JSON.parse(rawBody) as FilesOpRequest;
  } catch {
    return fail(requestId, "INVALID_INPUT", "Invalid JSON body", 400);
  }
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
  try {
    return await dispatch(env, requestId, body, new URL(request.url).origin);
  } catch (error) {
    if (error instanceof MetadataCapacityError) {
      return fail(
        requestId,
        "AI_CAPACITY",
        error.message,
        429,
        false,
        error.aiFacts
      );
    }
    if (error instanceof MetadataValidationError) {
      return fail(
        requestId,
        "AI_INVALID_OUTPUT",
        error.message,
        502,
        true,
        error.aiFacts
      );
    }
    if (
      (error instanceof Error && error.message === "source_not_found") ||
      error instanceof InspectSourceMissing
    ) {
      return fail(requestId, "NOT_FOUND", error.message, 404);
    }
    if (
      (error instanceof Error && error.message === "source_too_large") ||
      error instanceof ExportTooLarge ||
      error instanceof ArchiveEntryTooLargeError
    ) {
      return fail(requestId, "PAYLOAD_TOO_LARGE", error.message, 413);
    }
    if (
      error instanceof RendererUnavailable ||
      (error instanceof Error && error.message === "browser_unavailable")
    ) {
      console.warn("[files-worker] renderer unavailable", {
        message: error.message,
        op: body.op,
        requestId,
      });
      return fail(requestId, "RENDERER_UNAVAILABLE", error.message, 503, true);
    }
    if (
      error instanceof RendererDeclined ||
      (error instanceof Error &&
        [
          "image_transform_failed",
          "image_dimensions_missing",
          "not_an_image",
          "image_dimensions_too_large",
          "audio_decode_failed",
        ].includes(error.message))
    ) {
      return fail(requestId, "UNSUPPORTED", error.message, 415);
    }
    if (error instanceof ExportManifestInvalid) {
      return fail(requestId, "INVALID_INPUT", error.message, 400);
    }
    const message = error instanceof Error ? error.message : "internal_error";
    if (message.startsWith("invalid_") || message === "archive_parse_failed") {
      return fail(requestId, "INVALID_INPUT", message, 400);
    }
    if (message === "source_changed") {
      return fail(requestId, "CONFLICT", message, 409);
    }
    // Error objects serialize to {} in Workers logs, so log their fields.
    console.error("[files-worker] operation failed", {
      message,
      op: body.op,
      requestId,
      stack: error instanceof Error ? error.stack : undefined,
    });
    const objectKey = getFilesOpObjectKey(body.params);
    await reportFilesOpFailure(env, ctx, body.op, error, {
      httpMethod: request.method,
      httpPath: "/__ops/v1",
      objectKey,
    });
    return fail(requestId, "INTERNAL", "Internal operation failed", 500, true);
  }
};
