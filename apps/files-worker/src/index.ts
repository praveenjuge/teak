import { withSentry } from "@sentry/cloudflare";
import {
  buildExportIntoBucket,
  ExportManifestInvalid,
  ExportTooLarge,
} from "./export";
import { ImageSourceMissing, ImageTooLarge, processImage } from "./image";
import { InspectSourceMissing, runInspect } from "./inspect";
import {
  FILES_CACHE_CONTROL,
  FILES_EDGE_CACHE_CONTROL,
  parseSingleByteRange,
  verifySignedFileRequest,
  verifySignedOpRequest,
} from "./lib";
import { reportFilesOpFailure, resolveSentryOptions } from "./sentry";

export interface Env {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
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

/**
 * Signed URLs act as bearer credentials, so permissive CORS cannot leak
 * anything that isn't already in the URL; it lets the web app fetch files
 * with progress/streaming instead of navigating.
 */
const withCorsHeaders = (headers: Headers): void => {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, If-None-Match");
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

/**
 * Internal signed ops: image processing, export building, file inspection. Payload shapes are defined in lib.ts / wasm.ts consumers; Convex
 * mirrors them in packages/convex/storage/filesWorkerClient.ts.
 */
const handleOp = async (
  env: Env,
  url: URL,
  httpMethod: string,
  key: string,
  op: string
): Promise<Response> => {
  const query = url.searchParams;
  // Signed extra-field order per op; empty-string slots are allowed. Must
  // stay in lockstep with OP_PARAM_ORDER in filesWorkerClient.ts.
  const fieldNamesByOp: Record<string, string[]> = {
    "process-image": ["dest", "preview"],
    "build-export": ["artifact", "name"],
    inspect: ["mode", "mb", "rtf", "fmt"],
  };
  const fieldNames = fieldNamesByOp[op];
  if (!fieldNames) {
    return json({ error: "unknown_op" }, 400);
  }
  const fields = fieldNames.map((name) => query.get(name) ?? "");
  const verification = await verifySignedOpRequest(
    env.FILES_SIGNING_SECRET,
    op,
    key,
    {
      fields,
      exp: query.get("exp"),
      sig: query.get("sig"),
    }
  );
  if (!verification.ok) {
    return new Response(null, { status: verification.status });
  }

  try {
    switch (op) {
      case "process-image": {
        const result = await processImage(env.BUCKET, key, fields[0] || null, {
          previewDestKey: fields[1] || null,
        });
        return json(result);
      }
      case "build-export": {
        const [artifactKey, fileName] = fields;
        if (!(artifactKey && isValidArtifactName(fileName ?? ""))) {
          return json({ error: "invalid_params" }, 400);
        }
        const result = await buildExportIntoBucket(
          env.BUCKET,
          key,
          artifactKey,
          fileName as string
        );
        return json(result);
      }
      case "inspect": {
        const [mode, mb, rtf] = fields;
        if (mode !== "zip" && mode !== "css" && mode !== "text") {
          return json({ error: "invalid_mode" }, 400);
        }
        const maxBytes = Number.parseInt(mb ?? "", 10);
        if (
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0 ||
          maxBytes > 64 * 1024 * 1024
        ) {
          return json({ error: "invalid_max_bytes" }, 400);
        }
        const result = await runInspect(
          env.BUCKET,
          key,
          mode,
          query.get("fmt") ?? "",
          maxBytes,
          rtf === "1"
        );
        return json(result);
      }
      default:
        return json({ error: "unknown_op" }, 400);
    }
  } catch (error) {
    if (
      error instanceof ImageSourceMissing ||
      error instanceof InspectSourceMissing
    ) {
      return json({ error: error.message }, 404);
    }
    if (error instanceof ImageTooLarge) {
      // Callers treat this as "fall back to the legacy action path".
      return json({ error: error.message }, 413);
    }
    if (error instanceof ExportManifestInvalid) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof ExportTooLarge) {
      return json({ error: error.message }, 413);
    }
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "decode_failed" || message === "archive_parse_failed") {
      return json({ error: message }, 422);
    }
    console.error(`[files-worker] op ${op} failed`, error);
    // Handled 500s never reach withSentry's automatic capture, so report them
    // here; without this an op outage is invisible outside wrangler tail.
    reportFilesOpFailure(op, error, {
      httpMethod,
      httpPath: url.pathname,
      objectKey: key,
    });
    return json({ error: "internal_error" }, 500);
  }
};

const isValidArtifactName = (name: string): boolean =>
  name.length > 0 &&
  name.length <= 200 &&
  !name.includes('"') &&
  !name.includes("\\") &&
  !name.includes("\0");

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

    if (requestMethod === "OPTIONS") {
      return corsPreflight();
    }
    if (requestMethod !== "GET" && requestMethod !== "HEAD") {
      return new Response(null, { status: 405 });
    }

    const url = new URL(request.url);

    // Unauthenticated liveness probe for uptime monitors.
    if (url.pathname === "/__health") {
      return json({ ok: true });
    }

    const key = decodeObjectKey(url.pathname);
    if (!key || key.includes("..")) {
      return new Response(null, { status: 404 });
    }

    const op = url.searchParams.get("op");
    if (op) {
      return await handleOp(env, url, requestMethod, key, op);
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
