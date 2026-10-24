import {
  gatedBucket,
  ObjectWriteBlockedError,
  objectIsFrozen,
} from "./deletionGate";

export { ObjectDeletionGate } from "./deletionGate";
export { MediaRenderer } from "./media/mediaRenderer";
export { LinkFetcher } from "./media/remoteAsset";
export {
  AccountDeletionWorkflow,
  CardProcessingWorkflow,
  ExportWorkflow,
  ImportWorkflow,
  MaintenanceWorkflow,
} from "./workflows/entrypoints";

import { PAGE_ARCHIVE_ROLE } from "@teak/convex/shared/pageArchive";
import {
  buildMultipartPartSigningPayload,
  FILES_EDGE_CACHE_CONTROL,
  FILES_IMAGE_PATH,
  FILES_IMAGE_SOURCE_PATH,
  FILES_PRIVATE_CACHE_CONTROL,
  FILES_PROTOCOL_VERSION,
  type FilesErrorCode,
  parseCardObjectKey,
} from "@teak/files-protocol";
import { PAGE_ARCHIVE_CONTENT_SECURITY_POLICY } from "./archive/inline";
import { handleApiProxyRequest } from "./edge/apiProxy";
import {
  applyEdgeRateLimit,
  type EdgeRateLimitEnv,
} from "./edge/edgeRateLimit";
import {
  handleImageRequest,
  handleImageSourceRequest,
} from "./images/imageTransform";
import {
  parseSingleByteRange,
  verifyHmacPayload,
  verifySignedFileRequest,
} from "./lib";
import { handleInternalOp } from "./ops";
import { handleQueueBatch } from "./queues";
import { handleScheduled } from "./scheduled/cron";
import { retryingReads } from "./storage/r2Retry";
import { handleSignedUpload } from "./storage/upload";
import { reportUnhandledError } from "./telemetry";
import type { BackgroundEnv } from "./workflows/runtime";

export type Env = BackgroundEnv & EdgeRateLimitEnv;

const decodeObjectKey = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const multipartError = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number,
  retryable = false
): Response => {
  const response = json(
    {
      error: { code, message, requestId, retryable },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    },
    status
  );
  allowAnyOriginForSignedUrl(response.headers);
  return response;
};

const methodNotAllowed = (
  request: Request,
  allow: "POST" | "PUT"
): Response => {
  const response = multipartError(
    request.headers.get("x-teak-request-id") ?? crypto.randomUUID(),
    "INVALID_INPUT",
    `Method must be ${allow}`,
    405
  );
  response.headers.set("Allow", allow);
  return response;
};

const allowAnyOriginForSignedUrl = (headers: Headers): void => {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Range, If-None-Match"
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Content-Disposition, ETag, Accept-Ranges"
  );
  headers.set("Access-Control-Max-Age", "86400");
};

const corsPreflight = (): Response => {
  const headers = new Headers();
  allowAnyOriginForSignedUrl(headers);
  return new Response(null, { status: 204, headers });
};

const MULTIPART_URL_MAX_TTL_SECONDS = 60 * 60;
const MULTIPART_MAX_PART_BYTES = 16 * 1024 * 1024;

const handleMultipartPart = async (
  request: Request,
  env: Env,
  url: URL
): Promise<Response> => {
  const requestId =
    request.headers.get("x-teak-request-id") ?? crypto.randomUUID();
  const match = /^\/__uploads\/v1\/([^/]+)\/(\d+)$/u.exec(url.pathname);
  const key = url.searchParams.get("key");
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  const boundSizeText = url.searchParams.get("sz");
  const boundSize = boundSizeText === null ? null : Number(boundSizeText);
  if (!(match && key && expiresAt && signature)) {
    return multipartError(
      requestId,
      "AUTH_INVALID",
      "Request authentication failed",
      401
    );
  }
  const uploadId = decodeURIComponent(match[1] ?? "");
  const partNumber = Number.parseInt(match[2] ?? "", 10);
  const expiry = Number.parseInt(expiresAt, 10);
  const now = Math.floor(Date.now() / 1000);
  if (
    !(uploadId && Number.isSafeInteger(partNumber)) ||
    partNumber < 1 ||
    partNumber > 100 ||
    !Number.isSafeInteger(expiry) ||
    String(expiry) !== expiresAt ||
    expiry < now ||
    (boundSize !== null &&
      (!Number.isSafeInteger(boundSize) ||
        boundSize <= 0 ||
        boundSize > 64 * 1024 * 1024 ||
        String(boundSize) !== boundSizeText)) ||
    expiry > now + (boundSize === null ? MULTIPART_URL_MAX_TTL_SECONDS : 86_400)
  ) {
    return multipartError(
      requestId,
      expiry < now ? "AUTH_EXPIRED" : "AUTH_INVALID",
      "Request authentication failed",
      expiry < now ? 410 : 403
    );
  }
  const valid = await verifyHmacPayload(
    env.FILES_SIGNING_SECRET,
    buildMultipartPartSigningPayload({
      expiresAt,
      key,
      partNumber,
      uploadId,
      size: boundSize,
    }),
    signature
  );
  if (!valid) {
    return multipartError(
      requestId,
      "AUTH_INVALID",
      "Request authentication failed",
      403
    );
  }
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (!(request.body && Number.isSafeInteger(contentLength))) {
    return multipartError(
      requestId,
      "INVALID_INPUT",
      "Multipart part Content-Length is required",
      411
    );
  }
  if (
    contentLength <= 0 ||
    contentLength >
      (boundSize === null ? MULTIPART_MAX_PART_BYTES : boundSize) ||
    (boundSize !== null && contentLength !== boundSize)
  ) {
    return multipartError(
      requestId,
      "PAYLOAD_TOO_LARGE",
      "Multipart part size is invalid",
      413
    );
  }
  try {
    // Pass the original fixed-length request stream to R2. Wrapping it in a
    // TransformStream discards the runtime's known-length metadata and makes
    // R2 reject otherwise-valid multipart parts in production.
    const uploaded = await env.BUCKET.resumeMultipartUpload(
      key,
      uploadId
    ).uploadPart(partNumber, request.body);
    const headers = new Headers({ ETag: uploaded.etag });
    allowAnyOriginForSignedUrl(headers);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    if (error instanceof ObjectWriteBlockedError) {
      return multipartError(
        requestId,
        "CONFLICT",
        "Object writes are blocked",
        409
      );
    }
    console.error("[files-worker] multipart part upload failed", {
      error: error instanceof Error ? error.message : String(error),
      partNumber,
    });
    return multipartError(
      requestId,
      "INTERNAL",
      "Multipart upload failed",
      500,
      true
    );
  }
};

const buildCacheKey = (request: Request): Request => {
  const url = new URL(request.url);
  const cacheUrl = new URL(url.origin + url.pathname);
  const contentType = url.searchParams.get("ct");
  const contentDisposition = url.searchParams.get("cd");
  if (contentType) {
    cacheUrl.searchParams.set("ct", contentType);
  }
  if (contentDisposition) {
    cacheUrl.searchParams.set("cd", contentDisposition);
  }
  return new Request(cacheUrl.toString(), {
    method: "GET",
    headers: { accept: request.headers.get("accept") ?? "*/*" },
  });
};

const etagMatches = (ifNoneMatch: string | null, httpEtag: string): boolean => {
  if (!ifNoneMatch) {
    return false;
  }
  if (ifNoneMatch.trim() === "*") {
    return true;
  }
  const normalize = (tag: string): string =>
    tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return ifNoneMatch
    .split(",")
    .some((candidate) => normalize(candidate) === normalize(httpEtag));
};

const applyObjectHeaders = (
  headers: Headers,
  request: Request,
  key: string,
  objectHttpMetadata: R2HTTPMetadata | undefined,
  httpEtag: string,
  contentLength: number | null
): void => {
  const url = new URL(request.url);
  headers.set("Cache-Control", FILES_PRIVATE_CACHE_CONTROL);
  headers.set("ETag", httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (contentLength !== null) {
    headers.set("Content-Length", String(contentLength));
  }
  headers.set(
    "Content-Type",
    url.searchParams.get("ct") ||
      objectHttpMetadata?.contentType ||
      "application/octet-stream"
  );
  const contentDisposition =
    url.searchParams.get("cd") || objectHttpMetadata?.contentDisposition;
  if (contentDisposition) {
    headers.set("Content-Disposition", contentDisposition);
  }
  if (parseCardObjectKey(key).role === PAGE_ARCHIVE_ROLE) {
    headers.set(
      "Content-Security-Policy",
      PAGE_ARCHIVE_CONTENT_SECURITY_POLICY
    );
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }
  allowAnyOriginForSignedUrl(headers);
};

const handler = {
  async fetch(request, bindings, ctx): Promise<Response> {
    const requestMethod = request.method.toUpperCase();
    const url = new URL(request.url);

    const apiResponse = await handleApiProxyRequest(request, bindings, ctx, {
      cache: caches.default,
      rateLimit: (apiRequest) => applyEdgeRateLimit(apiRequest, bindings, ctx),
    });
    if (apiResponse) {
      return apiResponse;
    }
    if (bindings.API_PUBLIC_HOST && url.hostname === bindings.API_PUBLIC_HOST) {
      return await fetch(request);
    }

    if (requestMethod === "OPTIONS") {
      return corsPreflight();
    }

    if (url.pathname === "/__health") {
      if (requestMethod !== "GET" && requestMethod !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      return json({ ok: true });
    }

    if (!bindings.OBJECT_GATES) {
      return json({ error: "object_gate_not_configured" }, 503);
    }
    const env = {
      ...bindings,
      BUCKET: gatedBucket({
        ...bindings,
        BUCKET: retryingReads(bindings.BUCKET),
      }),
    };

    if (url.pathname === "/__ops/v1") {
      if (requestMethod !== "POST") {
        return methodNotAllowed(request, "POST");
      }
      return await handleInternalOp(request, env, ctx);
    }

    if (url.pathname.startsWith("/__uploads/v1/")) {
      if (requestMethod !== "PUT") {
        return methodNotAllowed(request, "PUT");
      }
      return await handleMultipartPart(request, env, url);
    }

    if (url.pathname.startsWith("/__upload/v1/")) {
      if (requestMethod !== "PUT") {
        return methodNotAllowed(request, "PUT");
      }
      return await handleSignedUpload(request, env, url);
    }

    if (url.pathname.startsWith(`${FILES_IMAGE_SOURCE_PATH}/`)) {
      if (requestMethod !== "GET" && requestMethod !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      return await handleImageSourceRequest(request, env, url);
    }

    if (url.pathname.startsWith(`${FILES_IMAGE_PATH}/`)) {
      if (requestMethod !== "GET" && requestMethod !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      return await handleImageRequest(request, env, fetch, undefined, ctx);
    }

    if (requestMethod !== "GET" && requestMethod !== "HEAD") {
      return new Response(null, { status: 405 });
    }

    const key = decodeObjectKey(url.pathname);
    if (!key || key.includes("\0")) {
      return new Response(null, { status: 404 });
    }

    const verification = await verifySignedFileRequest(
      env.FILES_SIGNING_SECRET,
      {
        key,
        exp: url.searchParams.get("exp"),
        sig: url.searchParams.get("sig"),
        ct: url.searchParams.get("ct"),
        cd: url.searchParams.get("cd"),
      },
      Math.floor(Date.now() / 1000)
    );
    if (!verification.ok) {
      return new Response(null, { status: verification.status });
    }

    if (await objectIsFrozen(env, key)) {
      return new Response(null, { status: 404 });
    }

    const parsedRange =
      requestMethod === "GET"
        ? parseSingleByteRange(request.headers.get("range"))
        : null;
    if (!parsedRange) {
      const isHead = requestMethod === "HEAD";
      const cacheKey = buildCacheKey(request);

      // The edge copy is keyed by path, so it outlives a deleted or replaced
      // object while a signed link is still valid. A head (one class B read,
      // no body) checks it still holds the stored object.
      const cached = isHead ? undefined : await caches.default.match(cacheKey);
      if (cached) {
        const cachedEtag = cached.headers.get("ETag");
        const current = await env.BUCKET.head(key);
        if (current && current.httpEtag === cachedEtag) {
          if (
            etagMatches(request.headers.get("if-none-match"), cachedEtag ?? "")
          ) {
            const notModifiedHeaders = new Headers(cached.headers);
            notModifiedHeaders.set(
              "Cache-Control",
              FILES_PRIVATE_CACHE_CONTROL
            );
            allowAnyOriginForSignedUrl(notModifiedHeaders);
            return new Response(null, {
              status: 304,
              headers: notModifiedHeaders,
            });
          }
          const headers = new Headers(cached.headers);
          headers.set("Cache-Control", FILES_PRIVATE_CACHE_CONTROL);
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
        await cached.body?.cancel();
        if (!current) {
          ctx.waitUntil(caches.default.delete(cacheKey));
          return new Response(null, { status: 404 });
        }
        // Replaced under the same key: the read below caches the new object.
      }

      const object = await env.BUCKET.get(key);
      if (!object) {
        return new Response(null, { status: 404 });
      }

      if (etagMatches(request.headers.get("if-none-match"), object.httpEtag)) {
        await object.body.cancel();
        const notModifiedHeaders = new Headers();
        applyObjectHeaders(
          notModifiedHeaders,
          request,
          key,
          object.httpMetadata,
          object.httpEtag,
          null
        );
        return new Response(null, { status: 304, headers: notModifiedHeaders });
      }

      const headers = new Headers();
      applyObjectHeaders(
        headers,
        request,
        key,
        object.httpMetadata,
        object.httpEtag,
        object.size
      );

      if (isHead) {
        await object.body.cancel();
        return new Response(null, { status: 200, headers });
      }

      const [clientBody, edgeBody] = object.body.tee();
      const response = new Response(clientBody, { headers });

      const edgeHeaders = new Headers(headers);
      edgeHeaders.set("Cache-Control", FILES_EDGE_CACHE_CONTROL);
      ctx.waitUntil(
        caches.default.put(
          cacheKey,
          new Response(edgeBody, { status: 200, headers: edgeHeaders })
        )
      );
      return response;
    }

    // Resolve the requested range against the true object size so the
    // Content-Range header is exact and out-of-bounds requests get a proper
    // 416 instead of relying on R2's clamping behavior.
    const meta = await env.BUCKET.head(key);
    if (!meta) {
      return new Response(null, { status: 404 });
    }
    const { size } = meta;

    let start: number;
    let length: number;
    if (parsedRange.kind === "offset") {
      start = parsedRange.offset;
      const rawEnd =
        parsedRange.length === undefined
          ? size - 1
          : Math.min(start + parsedRange.length - 1, size - 1);
      if (start >= size || rawEnd < start) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      length = rawEnd - start + 1;
    } else {
      length = Math.min(parsedRange.suffix, size);
      if (length <= 0) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      start = size - length;
    }

    const object = await env.BUCKET.get(key, {
      range: { offset: start, length },
    });
    if (!object) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    applyObjectHeaders(
      headers,
      request,
      key,
      object.httpMetadata,
      object.httpEtag,
      length
    );
    headers.set(
      "Content-Range",
      `bytes ${start}-${start + length - 1}/${size}`
    );

    return new Response(object.body, { status: 206, headers });
  },
} satisfies ExportedHandler<Env>;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await handler.fetch(request, env, ctx);
    } catch (error) {
      await reportUnhandledError(env, ctx, error, request);
      throw error;
    }
  },
  async queue(batch, env, ctx): Promise<void> {
    try {
      await handleQueueBatch(batch, env, ctx);
    } catch (error) {
      await reportUnhandledError(env, ctx, error);
      throw error;
    }
  },
  async scheduled(controller, env, ctx): Promise<void> {
    try {
      await handleScheduled(controller, env, ctx);
    } catch (error) {
      await reportUnhandledError(env, ctx, error);
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
