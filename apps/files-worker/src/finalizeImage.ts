// finalize-image-upload: commit an uploaded image into its permanent key only
// after the bytes have been decoded server-side. The worker returns trusted
// image facts (decoded format, dimensions, size) so Convex never has to trust
// client-provided MIME types or dimensions when creating the card.
import {
  FILES_PROCESSOR_VERSION,
  type FilesFinalizeImageParams,
  type FilesFinalizeImageResult,
} from "@teak/files-protocol";
import { inspectImageContainer } from "./imageContainer";
import { fetchPrivateImageSource } from "./imageTransform";
import type { Env } from "./index";
import { renderSvgToPng } from "./wasm";

// The Images binding accepts raw inputs up to 20 MB; larger images fall back
// to the URL-transformation JSON metadata probe.
const MAX_IMAGES_BINDING_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_CONTAINER_FALLBACK_BYTES = 1024 * 1024;
const MAX_IMAGE_DIMENSION = 10_000;

interface CloudflareImageInfo {
  format?: string;
  height?: number;
  original?: { height?: number; width?: number };
  width?: number;
}

export interface FinalizeImageFacts {
  decodedFormat: string;
  height: number | null;
  width: number | null;
}

const positiveDimension = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/** Normalize a binding/probe format token into an `image/*` MIME type. */
export const normalizeDecodedFormat = (
  raw: string,
  objectKey: string
): string => {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("/")) {
    return normalized.startsWith("image/") ? normalized : "";
  }
  // Token forms such as "jpeg" or "png" reported without a media type.
  const tokenMime: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  const mime =
    tokenMime[normalized] ??
    (objectKey.toLowerCase().endsWith(`.${normalized}`)
      ? `image/${normalized}`
      : undefined);
  return mime ?? "";
};

const isSvgKey = (key: string, contentType?: string): boolean =>
  contentType === "image/svg+xml" ||
  (key.toLowerCase().endsWith(".svg") &&
    (!contentType || ["application/xml", "text/xml"].includes(contentType)));

const assertUnchanged = (
  object: { httpEtag: string; size: number },
  expected: { httpEtag: string; size: number }
): void => {
  if (object.httpEtag !== expected.httpEtag || object.size !== expected.size) {
    throw new Error("source_changed");
  }
};

const factsFromBindingInfo = async (
  env: Env,
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts | null> => {
  if (!(env.IMAGES && expected.size <= MAX_IMAGES_BINDING_INPUT_BYTES)) {
    return null;
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new Error("source_not_found");
  }
  try {
    // Only decode bytes that are still the object we validated above.
    assertUnchanged(object, expected);
    const info = (await env.IMAGES.info(object.body)) as CloudflareImageInfo;
    if (info.format === "image/svg+xml") {
      // SVG has no raster dimensions in binding info; the resvg probe below
      // resolves them.
      return null;
    }
    const format = normalizeDecodedFormat(info.format ?? "", sourceKey);
    const width = positiveDimension(info.original?.width ?? info.width);
    const height = positiveDimension(info.original?.height ?? info.height);
    if (!(format && width && height)) {
      throw new Error("not_an_image");
    }
    return { decodedFormat: format, height, width };
  } catch (error) {
    if (error instanceof Error && error.message === "not_an_image") {
      throw error;
    }
    try {
      await object.body.cancel();
    } catch {
      // The binding may already have locked or consumed the stream.
    }
    return null;
  }
};

const factsFromSvg = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts> => {
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new Error("source_not_found");
  }
  assertUnchanged(object, expected);
  if (object.size > 10 * 1024 * 1024) {
    await object.body.cancel();
    throw new Error("source_too_large");
  }
  const rendered = await renderSvgToPng(await object.text(), 64);
  return {
    decodedFormat: "image/svg+xml",
    height: rendered.originalHeight,
    width: rendered.originalWidth,
  };
};

const factsFromUrlProbe = async (
  env: Env,
  sourceKey: string,
  origin: string,
  imageFetch: typeof fetch,
  now: number
): Promise<FinalizeImageFacts> => {
  const response = await fetchPrivateImageSource(
    env,
    origin,
    sourceKey,
    { anim: false, format: "json" },
    imageFetch as never,
    now
  );
  if (!response.ok) {
    throw new Error("not_an_image");
  }
  const info = (await response.json()) as CloudflareImageInfo;
  const decodedFormat = normalizeDecodedFormat(info.format ?? "", sourceKey);
  const width = positiveDimension(info.original?.width ?? info.width);
  const height = positiveDimension(info.original?.height ?? info.height);
  if (!(decodedFormat && width && height)) {
    throw new Error("not_an_image");
  }
  return { decodedFormat, height, width };
};

const factsFromValidatedContainer = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts> => {
  if (expected.size > MAX_CONTAINER_FALLBACK_BYTES) {
    throw new Error("not_an_image");
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new Error("source_not_found");
  }
  assertUnchanged(object, expected);
  const facts = inspectImageContainer(
    new Uint8Array(await object.arrayBuffer())
  );
  if (!facts) {
    throw new Error("not_an_image");
  }
  return facts;
};

/**
 * Decode-verify the pending upload and stream it into its permanent key.
 * Throws typed error messages that ops.ts maps onto protocol error codes:
 * source_not_found / source_changed / source_too_large /
 * invalid_storage_key / not_an_image / image_dimensions_too_large.
 */
export const finalizeImageUpload = async (
  env: Env,
  params: FilesFinalizeImageParams,
  origin: string,
  imageFetch: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000)
): Promise<FilesFinalizeImageResult> => {
  const sourceKey = params.sourceKey;
  const destinationKey = params.destinationKey;
  const metadata = await env.BUCKET.head(sourceKey);
  if (!metadata) {
    throw new Error("source_not_found");
  }
  const expectedEtag =
    typeof params.expectedEtag === "string" && params.expectedEtag
      ? params.expectedEtag
      : null;
  const expectedSize =
    typeof params.expectedSize === "number" ? params.expectedSize : null;
  if (
    (expectedEtag && metadata.httpEtag !== expectedEtag) ||
    (expectedSize !== null && metadata.size !== expectedSize)
  ) {
    throw new Error("source_changed");
  }

  let facts: FinalizeImageFacts | null = null;
  if (isSvgKey(sourceKey, metadata.httpMetadata?.contentType)) {
    facts = await factsFromSvg(env.BUCKET, sourceKey, metadata);
  } else {
    facts = await factsFromBindingInfo(env, env.BUCKET, sourceKey, metadata);
    if (!facts) {
      // Binding metadata unavailable (missing binding, unsupported input, or
      // transient failure): fall back to the remote transformation probe.
      try {
        facts = await factsFromUrlProbe(
          env,
          sourceKey,
          origin,
          imageFetch,
          now
        );
      } catch (error) {
        if (error instanceof Error && error.message === "not_an_image") {
          // Cloudflare can reject a small browser-compatible image as
          // incomplete. Accept that edge case only after validating the
          // complete, bounded container and reading trusted dimensions.
          facts = await factsFromValidatedContainer(
            env.BUCKET,
            sourceKey,
            metadata
          );
        } else {
          throw error;
        }
      }
    }
  }

  if (
    (facts.width !== null && facts.width > MAX_IMAGE_DIMENSION) ||
    (facts.height !== null && facts.height > MAX_IMAGE_DIMENSION)
  ) {
    throw new Error("image_dimensions_too_large");
  }

  // Re-fetch and stream the verified source into its permanent key, pinning
  // the promotion to the exact bytes that were decoded above: if the pending
  // key changed between verification and this read, refuse instead of
  // promoting unverified bytes under stale trusted facts.
  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new Error("source_not_found");
  }
  if (source.httpEtag !== metadata.httpEtag || source.size !== metadata.size) {
    try {
      await source.body.cancel();
    } catch {
      // Already consumed.
    }
    throw new Error("source_changed");
  }
  const stored = await env.BUCKET.put(destinationKey, source.body, {
    httpMetadata: {
      ...source.httpMetadata,
      contentType: facts.decodedFormat,
    },
    customMetadata: {
      ...source.customMetadata,
      decodedFormat: facts.decodedFormat,
      processorVersion: FILES_PROCESSOR_VERSION,
      sourceEtag: source.httpEtag,
    },
  });

  return {
    decodedFormat: facts.decodedFormat,
    destinationKey,
    height: facts.height,
    sourceEtag: source.httpEtag,
    storedEtag: stored.httpEtag,
    storedFileSize: source.size,
    storedMimeType: facts.decodedFormat,
    width: facts.width,
  };
};
