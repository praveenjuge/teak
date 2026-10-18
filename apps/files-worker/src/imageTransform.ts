import {
  buildImageSigningPayload,
  buildImageSourceSigningPayload,
  FILES_IMAGE_PATH,
  FILES_IMAGE_SOURCE_PATH,
  type FilesImageRendition,
  isFilesImageRendition,
} from "@teak/files-protocol";
import { objectIsFrozen } from "./deletionGate";
import { throughImagesBinding } from "./imagesBinding";
import type { Env } from "./index";
import { hmacSha256Hex, verifyHmacPayload } from "./lib";
import { renderSvgToPng } from "./wasm";

const IMAGE_URL_MAX_TTL_SECONDS = 8 * 24 * 60 * 60;
const SOURCE_URL_TTL_SECONDS = 5 * 60;
const MAX_SVG_SOURCE_BYTES = 10 * 1024 * 1024;
const IMAGE_CACHE_CONTROL = "private, max-age=518400, immutable";
const IMAGE_EDGE_CACHE_CONTROL = "public, max-age=518400, immutable";
const BROWSER_SAFE_TRANSCODE_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/webp",
]);
const imageEdgeCache: Cache | null =
  typeof caches === "undefined" ? null : caches.default;

const MAX_RENDITION_ASPECT = 8;

export const IMAGE_RENDITIONS = {
  tiny: { edge: 48, quality: 60 },
  compact: { edge: 256, quality: 80 },
  grid: { edge: 512, quality: 80 },
  detail: { edge: 1600, quality: 85 },
} as const satisfies Record<
  FilesImageRendition,
  { edge: number; quality: number }
>;

type ImageFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { cf?: { image?: Record<string, unknown> } }
) => Promise<Response>;

export const fetchPrivateImageSource = async (
  env: Env,
  origin: string,
  key: string,
  image: Record<string, unknown>,
  imageFetch: ImageFetch = fetch as ImageFetch,
  now = Math.floor(Date.now() / 1000)
): Promise<Response> => {
  const sourceExpiresAt = String(now + SOURCE_URL_TTL_SECONDS);
  const sourceSignature = await hmacSha256Hex(
    env.FILES_SIGNING_SECRET,
    buildImageSourceSigningPayload({ expiresAt: sourceExpiresAt, key })
  );
  const sourceUrl = new URL(
    `${origin}${FILES_IMAGE_SOURCE_PATH}/${encodeURIComponent(key)}`
  );
  return await imageFetch(sourceUrl, {
    headers: {
      Authorization: `Teak ${sourceExpiresAt}:${sourceSignature}`,
    },
    cf: {
      image: {
        ...image,
        "origin-auth": "share-publicly",
      },
    },
  });
};

const renditionBounds = (
  rendition: FilesImageRendition
): { height: number; width: number } => {
  const { edge } = IMAGE_RENDITIONS[rendition];
  return { height: edge * MAX_RENDITION_ASPECT, width: edge };
};

export const buildImageTransformOptions = (
  rendition: FilesImageRendition,
  accept?: string | null
): Record<string, unknown> => {
  const preset = IMAGE_RENDITIONS[rendition];
  const format = preferredFormat(accept ?? null);
  return {
    anim: true,
    fit: "scale-down",
    metadata: "none",
    quality: preset.quality,
    sharpen: 1,
    ...renditionBounds(rendition),
    ...(format ? { format } : {}),
  };
};

const decodeKey = (encoded: string): string => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
};

const parseImagePath = (
  pathname: string
): { key: string; rendition: FilesImageRendition } | null => {
  const match = new RegExp(`^${FILES_IMAGE_PATH}/([^/]+)/(.+)$`, "u").exec(
    pathname
  );
  const rendition = match?.[1];
  const key = decodeKey(match?.[2] ?? "");
  return isFilesImageRendition(rendition) && key && !key.includes("\0")
    ? { key, rendition }
    : null;
};

const parseSourcePath = (pathname: string): string | null => {
  const prefix = `${FILES_IMAGE_SOURCE_PATH}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const key = decodeKey(pathname.slice(prefix.length));
  return key && !key.includes("\0") ? key : null;
};

const isExpiredOrInvalid = (expiresAt: string | null, now: number): boolean => {
  if (!expiresAt) {
    return true;
  }
  const expiry = Number.parseInt(expiresAt, 10);
  return (
    !Number.isSafeInteger(expiry) ||
    String(expiry) !== expiresAt ||
    expiry < now ||
    expiry > now + IMAGE_URL_MAX_TTL_SECONDS
  );
};

export const preferredFormat = (
  accept: string | null
): "avif" | "webp" | undefined => {
  const normalized = accept?.toLowerCase() ?? "";
  if (normalized.includes("image/avif")) {
    return "avif";
  }
  return normalized.includes("image/webp") ? "webp" : undefined;
};

const bindingOutputFormat = (
  format: "avif" | "webp" | undefined
): "image/avif" | "image/webp" | null => {
  if (format === "avif") {
    return "image/avif";
  }
  return format === "webp" ? "image/webp" : null;
};

const BINDING_TRANSFORM = { fit: "scale-down", sharpen: 1 } as const;
const BINDING_OUTPUT = { anim: true } as const;

export const transformViaBinding = (
  env: Env,
  key: string,
  rendition: FilesImageRendition,
  accept: string | null,
  sourceSize: number,
  bucket: R2Bucket = env.BUCKET
): Promise<Response | null> => {
  const outputFormat = bindingOutputFormat(preferredFormat(accept));
  if (!outputFormat) {
    return Promise.resolve(null);
  }
  return throughImagesBinding(
    env.IMAGES,
    sourceSize,
    () => bucket.get(key),
    async (images, object) => {
      const preset = IMAGE_RENDITIONS[rendition];
      const result = await images
        .input(object.body)
        .transform({
          ...BINDING_TRANSFORM,
          ...renditionBounds(rendition),
        })
        .output({
          ...BINDING_OUTPUT,
          format: outputFormat,
          quality: preset.quality,
        });
      const response = result.response();
      const headers = new Headers(response.headers);
      headers.set("Content-Type", result.contentType());
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Vary", "Accept");
      return new Response(response.body, {
        headers,
        status: response.status,
      });
    }
  );
};

const BINDING_CACHE_VERSION = [
  ...Object.values(IMAGE_RENDITIONS).map(
    ({ edge, quality }) => `${String(edge)}q${String(quality)}`
  ),
  `a${String(MAX_RENDITION_ASPECT)}`,
  `${BINDING_TRANSFORM.fit}s${String(BINDING_TRANSFORM.sharpen)}anim${String(BINDING_OUTPUT.anim)}`,
].join("-");

export const buildBindingCacheKey = (
  url: URL,
  sourceEtag: string,
  format: "avif" | "webp"
): Request =>
  new Request(
    `${url.origin}${url.pathname}?binding=${BINDING_CACHE_VERSION}&etag=${encodeURIComponent(sourceEtag)}&fmt=${format}`,
    { method: "GET" }
  );

const isSvgSource = (key: string, contentType: string): boolean =>
  contentType === "image/svg+xml" ||
  (key.toLowerCase().endsWith(".svg") &&
    (contentType === "application/xml" || contentType === "text/xml"));

const imageHeaders = (contentType: string): Headers =>
  new Headers({
    "Cache-Control": IMAGE_CACHE_CONTROL,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept",
  });

const edgeCacheResponse = (response: Response): Response => {
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set("Cache-Control", IMAGE_EDGE_CACHE_CONTROL);
  return new Response(clone.body, { headers, status: clone.status });
};

const serveR2Object = async (
  env: Env,
  key: string,
  method: string
): Promise<Response> => {
  const object = await env.BUCKET.get(key);
  if (!object) {
    return new Response(null, { status: 404 });
  }
  const headers = imageHeaders(
    object.httpMetadata?.contentType ?? "application/octet-stream"
  );
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  if (method === "HEAD") {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
};

const serveSvg = async (
  env: Env,
  key: string,
  rendition: FilesImageRendition,
  method: string
): Promise<Response> => {
  const object = await env.BUCKET.get(key);
  if (!object) {
    return new Response(null, { status: 404 });
  }
  if (object.size > MAX_SVG_SOURCE_BYTES) {
    await object.body.cancel();
    return new Response(null, { status: 413 });
  }
  const svg = await object.text();
  const rendered = await renderSvgToPng(svg, IMAGE_RENDITIONS[rendition].edge);
  const headers = imageHeaders("image/png");
  headers.set("Content-Length", String(rendered.bytes.byteLength));
  return new Response(method === "HEAD" ? null : rendered.bytes, { headers });
};

const validateOuterSignature = async (
  env: Env,
  url: URL,
  key: string,
  rendition: FilesImageRendition,
  now: number
): Promise<number | null> => {
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  if (isExpiredOrInvalid(expiresAt, now) || !signature) {
    return expiresAt && Number(expiresAt) < now ? 410 : 401;
  }
  if (!expiresAt) {
    return 401;
  }
  const valid = await verifyHmacPayload(
    env.FILES_SIGNING_SECRET,
    buildImageSigningPayload({ expiresAt, key, rendition }),
    signature
  );
  return valid ? null : 403;
};

export const handleImageSourceRequest = async (
  request: Request,
  env: Env,
  url = new URL(request.url),
  now = Math.floor(Date.now() / 1000)
): Promise<Response> => {
  const key = parseSourcePath(url.pathname);
  const via = request.headers.get("via")?.toLowerCase() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Teak ([0-9]+):([a-f0-9]{64})$/u.exec(authorization);
  if (!(key && via.includes("image-resizing") && match)) {
    return new Response(null, { status: 403 });
  }
  const expiresAt = match[1] ?? "";
  const signature = match[2] ?? "";
  if (isExpiredOrInvalid(expiresAt, now)) {
    return new Response(null, { status: 403 });
  }
  const valid = await verifyHmacPayload(
    env.FILES_SIGNING_SECRET,
    buildImageSourceSigningPayload({ expiresAt, key }),
    signature
  );
  if (valid && (await objectIsFrozen(env, key))) {
    return new Response(null, { status: 404 });
  }
  return valid
    ? await serveR2Object(env, key, request.method.toUpperCase())
    : new Response(null, { status: 403 });
};

export const handleImageRequest = async (
  request: Request,
  env: Env,
  imageFetch: ImageFetch = fetch as ImageFetch,
  now = Math.floor(Date.now() / 1000),
  ctx?: ExecutionContext,
  edgeCache: Cache | null = imageEdgeCache
): Promise<Response> => {
  const url = new URL(request.url);
  const parsed = parseImagePath(url.pathname);
  if (!parsed) {
    return new Response(null, { status: 404 });
  }
  const invalidStatus = await validateOuterSignature(
    env,
    url,
    parsed.key,
    parsed.rendition,
    now
  );
  if (invalidStatus) {
    return new Response(null, { status: invalidStatus });
  }

  if (await objectIsFrozen(env, parsed.key)) {
    return new Response(null, { status: 404 });
  }
  const metadata = await env.BUCKET.head(parsed.key);
  if (!metadata) {
    return new Response(null, { status: 404 });
  }
  const contentType =
    metadata.httpMetadata?.contentType
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  const requiresBrowserSafeTranscode =
    contentType === "image/heic" || contentType === "image/heif";
  if (isSvgSource(parsed.key, contentType)) {
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    if (request.method === "GET") {
      const cached = edgeCache ? await edgeCache.match(cacheKey) : null;
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
        return new Response(cached.body, { headers, status: cached.status });
      }
    }
    const response = await serveSvg(
      env,
      parsed.key,
      parsed.rendition,
      request.method
    );
    if (request.method === "GET" && response.ok && edgeCache && ctx) {
      ctx.waitUntil(edgeCache.put(cacheKey, edgeCacheResponse(response)));
    }
    return response;
  }
  if (!contentType.startsWith("image/")) {
    return new Response(null, { status: 415 });
  }

  const accept = request.headers.get("accept");
  const negotiatedFormat = preferredFormat(accept);
  if (env.IMAGES && negotiatedFormat) {
    const cacheKey = buildBindingCacheKey(
      url,
      metadata.httpEtag,
      negotiatedFormat
    );
    if (request.method === "GET" && edgeCache) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
        return new Response(cached.body, { headers, status: cached.status });
      }
    }
    const bound = await transformViaBinding(
      env,
      parsed.key,
      parsed.rendition,
      accept,
      metadata.size
    );
    if (bound) {
      bound.headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
      bound.headers.set(
        "ETag",
        `W/"${metadata.httpEtag.replace(/"/g, "")}-${parsed.rendition}"`
      );
      if (request.method === "GET" && bound.ok && edgeCache && ctx) {
        ctx.waitUntil(edgeCache.put(cacheKey, edgeCacheResponse(bound)));
      }
      return new Response(request.method === "GET" ? bound.body : null, {
        headers: bound.headers,
        status: bound.status,
      });
    }
  }

  const transformOptions = buildImageTransformOptions(
    parsed.rendition,
    request.headers.get("accept")
  );
  if (!transformOptions.format && requiresBrowserSafeTranscode) {
    // HEIC/HEIF originals are not browser-safe. Always ask the URL fallback
    // for JPEG when the client did not negotiate AVIF or WebP.
    transformOptions.format = "jpeg";
  }
  const transformed = await fetchPrivateImageSource(
    env,
    url.origin,
    parsed.key,
    transformOptions,
    imageFetch,
    now
  );

  if (!transformed.ok) {
    const browserSafe = new Set([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    return browserSafe.has(contentType)
      ? await serveR2Object(env, parsed.key, request.method)
      : new Response(null, { status: 415 });
  }

  const transformedContentType =
    transformed.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (
    requiresBrowserSafeTranscode &&
    !BROWSER_SAFE_TRANSCODE_TYPES.has(transformedContentType)
  ) {
    await transformed.body?.cancel();
    return new Response(null, { status: 415 });
  }

  const headers = new Headers(transformed.headers);
  headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
  headers.set("Vary", "Accept");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : transformed.body, {
    headers,
    status: transformed.status,
  });
};
