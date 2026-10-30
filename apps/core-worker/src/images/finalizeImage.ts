import {
  FILES_PROCESSOR_VERSION,
  type FilesFinalizeImageParams,
  type FilesFinalizeImageResult,
} from "@teak/files-protocol";
import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import { inspectImageContainer } from "./imageContainer";
import { throughImagesBinding } from "./imagesBinding";
import { fetchPrivateImageSource } from "./imageTransform";
import { renderSvgToPng } from "./wasm";

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

export const normalizeDecodedFormat = (
  raw: string,
  objectKey: string
): string => {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("/")) {
    return normalized.startsWith("image/") ? normalized : "";
  }
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
    throw new OpFailure("source_changed");
  }
};

const factsFromBindingInfo = async (
  env: Env,
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts | null> => {
  const facts = await throughImagesBinding(
    env.IMAGES,
    expected.size,
    async () => {
      const object = await bucket.get(sourceKey);
      if (!object) {
        throw new OpFailure("source_not_found");
      }
      return object;
    },
    async (images, object) => {
      assertUnchanged(object, expected);
      const info = (await images.info(object.body)) as CloudflareImageInfo;
      if (info.format === "image/svg+xml") {
        // SVG has no raster dimensions in binding info; the resvg probe below
        // resolves them.
        return null;
      }
      const format = normalizeDecodedFormat(info.format ?? "", sourceKey);
      const width = positiveDimension(info.original?.width ?? info.width);
      const height = positiveDimension(info.original?.height ?? info.height);
      return format && width && height
        ? { decodedFormat: format, height, width }
        : "not_an_image";
    }
  );
  if (facts === "not_an_image") {
    throw new OpFailure("not_an_image");
  }
  return facts;
};

const factsFromSvg = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts> => {
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  assertUnchanged(object, expected);
  if (object.size > 10 * 1024 * 1024) {
    await object.body.cancel();
    throw new OpFailure("source_too_large");
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
    throw new OpFailure("not_an_image");
  }
  const info = (await response.json()) as CloudflareImageInfo;
  const decodedFormat = normalizeDecodedFormat(info.format ?? "", sourceKey);
  const width = positiveDimension(info.original?.width ?? info.width);
  const height = positiveDimension(info.original?.height ?? info.height);
  if (!(decodedFormat && width && height)) {
    throw new OpFailure("not_an_image");
  }
  return { decodedFormat, height, width };
};

const factsFromValidatedContainer = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts> => {
  if (expected.size > MAX_CONTAINER_FALLBACK_BYTES) {
    throw new OpFailure("not_an_image");
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  assertUnchanged(object, expected);
  const facts = inspectImageContainer(
    new Uint8Array(await object.arrayBuffer())
  );
  if (!facts) {
    throw new OpFailure("not_an_image");
  }
  return facts;
};

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
    throw new OpFailure("source_not_found");
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
    throw new OpFailure("source_changed");
  }

  let facts: FinalizeImageFacts | null = null;
  if (isSvgKey(sourceKey, metadata.httpMetadata?.contentType)) {
    facts = await factsFromSvg(env.BUCKET, sourceKey, metadata);
  } else {
    facts = await factsFromBindingInfo(env, env.BUCKET, sourceKey, metadata);
    if (!facts) {
      try {
        facts = await factsFromUrlProbe(
          env,
          sourceKey,
          origin,
          imageFetch,
          now
        );
      } catch (error) {
        if (error instanceof OpFailure && error.code === "not_an_image") {
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
    throw new OpFailure("image_dimensions_too_large");
  }

  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new OpFailure("source_not_found");
  }
  if (source.httpEtag !== metadata.httpEtag || source.size !== metadata.size) {
    await source.body.cancel().catch(() => undefined);
    throw new OpFailure("source_changed");
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
