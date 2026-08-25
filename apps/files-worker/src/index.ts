import { withSentry } from "@sentry/cloudflare";
import {
  buildMultipartPartSigningPayload,
  FILES_IMAGE_PATH,
  FILES_IMAGE_SOURCE_PATH,
  FILES_PROTOCOL_VERSION,
  type FilesErrorCode,
} from "@teak/files-protocol";
import { handleImageRequest, handleImageSourceRequest } from "./imageTransform";
import {
  FILES_CACHE_CONTROL,
  FILES_EDGE_CACHE_CONTROL,
  parseSingleByteRange,
  verifyHmacPayload,
  verifySignedFileRequest,
} from "./lib";
import { handleInternalOp } from "./ops";
import { resolveSentryOptions } from "./sentry";
import { handleSignedUpload } from "./upload";

export interface Env {
  /** Workers AI binding; used for image understanding in generate-image-metadata. */
  AI?: {
    run: (model: string, args: Record<string, unknown>) => Promise<unknown>;
  };
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
  /** Cloudflare Images binding; reserved for metadata inspection of eligible rasters. */
  IMAGES?: unknown;
  /** Wrangler secret; error reporting stays disabled until it is set. */
  SENTRY_DSN?: string;
  /** Optional overrides, normally left unset. */
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
}

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
  withCorsHeaders(response.headers);
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

/**
 * Signed URLs act as bearer credentials, so permissive CORS cannot leak
 * anything that isn't already in the URL; it lets the web app fetch files
 * with progress/streaming instead of navigating.
 */
const withCorsHeaders = (headers: Headers): void => {
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
  withCorsHeaders(headers);
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
    expiry > now + MULTIPART_URL_MAX_TTL_SECONDS
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
  if (contentLength <= 0 || contentLength > MULTIPART_MAX_PART_BYTES) {
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
    withCorsHeaders(headers);
    return new Response(null, { status: 204, headers });
  } catch (error) {
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

/**
 * Edge-cache key for a full-object response. The object key already embeds the
 * owning user's hash prefix, so entries are never shared across users; ct/cd
 * are folded in because they vary per request policy (inline vs attachment)
 * and are echoed back verbatim from the cached headers.
 */
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

/** ETag comparison tolerant of weak validators and quoting styles. */
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
  objectHttpMetadata: R2HTTPMetadata | undefined,
  httpEtag: string,
  objectSize?: number
): void => {
  const url = new URL(request.url);
  headers.set("Cache-Control", FILES_CACHE_CONTROL);
  headers.set("ETag", httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (objectSize !== undefined && request.method !== "HEAD") {
    // Explicit length enables client-side progress; for HEAD responses the
    // length is set by the caller alongside the emulated status.
    headers.set("Content-Length", String(objectSize));
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
  withCorsHeaders(headers);
};

/** Edge Cache API; absent in unit-test runtimes, always present on Workers. */
const edgeCache: Cache | null =
  typeof caches === "undefined" ? null : caches.default;

const handler = {
  async fetch(request, env, ctx): Promise<Response> {
    const requestMethod = request.method.toUpperCase();
    const url = new URL(request.url);

    if (requestMethod === "OPTIONS") {
      return corsPreflight();
    }

    // Unauthenticated liveness probe for uptime monitors.
    if (url.pathname === "/__health") {
      if (requestMethod !== "GET" && requestMethod !== "HEAD") {
        return new Response(null, { status: 405 });
      }
      return json({ ok: true });
    }

    if (url.pathname === "/__ops/v1") {
      if (requestMethod !== "POST") {
        return methodNotAllowed(request, "POST");
      }
      return await handleInternalOp(request, env);
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

    // Mutating operations were historically GET query parameters. Refuse the
    // legacy shape explicitly so HEAD/GET can never trigger storage writes.
    if (url.searchParams.has("op")) {
      return json({ error: "legacy_op_removed" }, 410);
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

    // Only full-object responses are served from (and written to) the edge
    // cache; ranged video/audio requests always go to R2 so seeking stays
    // accurate.
    const parsedRange =
      requestMethod === "GET"
        ? parseSingleByteRange(request.headers.get("range"))
        : null;
    if (!parsedRange) {
      const isHead = requestMethod === "HEAD";
      const cacheKey = buildCacheKey(request);

      if (!isHead) {
        const cached = edgeCache ? await edgeCache.match(cacheKey) : null;
        if (cached) {
          const cachedEtag = cached.headers.get("ETag");
          if (
            etagMatches(request.headers.get("if-none-match"), cachedEtag ?? "")
          ) {
            const notModifiedHeaders = new Headers(cached.headers);
            notModifiedHeaders.set("Cache-Control", FILES_CACHE_CONTROL);
            withCorsHeaders(notModifiedHeaders);
            return new Response(null, {
              status: 304,
              headers: notModifiedHeaders,
            });
          }
          // The edge copy is stored with a public directive (the Cache API
          // refuses to store private responses); browsers must still receive
          // the private variant.
          const headers = new Headers(cached.headers);
          headers.set("Cache-Control", FILES_CACHE_CONTROL);
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
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
          object.httpMetadata,
          object.httpEtag,
          object.size
        );
        notModifiedHeaders.delete("Content-Length");
        return new Response(null, { status: 304, headers: notModifiedHeaders });
      }

      const headers = new Headers();
      applyObjectHeaders(
        headers,
        request,
        object.httpMetadata,
        object.httpEtag,
        object.size
      );

      if (isHead) {
        await object.body.cancel();
        headers.set("Content-Length", String(object.size));
        return new Response(null, { status: 200, headers });
      }

      const [clientBody, edgeBody] = object.body.tee();
      const response = new Response(clientBody, { headers });

      const edgeHeaders = new Headers(headers);
      edgeHeaders.set("Cache-Control", FILES_EDGE_CACHE_CONTROL);
      if (edgeCache) {
        ctx.waitUntil(
          edgeCache.put(
            cacheKey,
            new Response(edgeBody, { status: 200, headers: edgeHeaders })
          )
        );
      }
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
    applyObjectHeaders(headers, request, object.httpMetadata, object.httpEtag);
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${start}-${start + length - 1}/${size}`
    );

    return new Response(object.body, { status: 206, headers });
  },
} satisfies ExportedHandler<Env>;

export default withSentry<Env>(
  // Secrets exist only on env at request time, so the SDK initializes per
  // request; without SENTRY_DSN this resolves to undefined and Sentry stays
  // disabled. See src/sentry.ts.
  (env) => resolveSentryOptions(env),
  handler
);
