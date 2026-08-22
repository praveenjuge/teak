import {
  FILES_CACHE_CONTROL,
  parseSingleByteRange,
  verifySignedFileRequest,
} from "./lib";

export interface Env {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
}

const decodeObjectKey = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return "";
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

const applyObjectHeaders = (
  headers: Headers,
  request: Request,
  objectHttpMetadata: R2HTTPMetadata | undefined,
  httpEtag: string
): void => {
  const url = new URL(request.url);
  headers.set("Cache-Control", FILES_CACHE_CONTROL);
  headers.set("ETag", httpEtag);
  headers.set("Accept-Ranges", "bytes");
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
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== "GET") {
      return new Response(null, { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeObjectKey(url.pathname);
    if (!key || key.includes("..")) {
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
      }
    );
    if (!verification.ok) {
      return new Response(null, { status: verification.status });
    }

    // Only full-object responses are served from (and written to) the edge
    // cache; ranged video/audio requests always go to R2 so seeking stays
    // accurate.
    const parsedRange = parseSingleByteRange(request.headers.get("range"));
    if (!parsedRange) {
      const cacheKey = buildCacheKey(request);
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        return cached;
      }

      const object = await env.BUCKET.get(key);
      if (!object) {
        return new Response(null, { status: 404 });
      }

      const headers = new Headers();
      applyObjectHeaders(headers, request, object.httpMetadata, object.httpEtag);
      const response = new Response(object.body, { headers });

      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
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
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${size}`);

    return new Response(object.body, { status: 206, headers });
  },
} satisfies ExportedHandler<Env>;
