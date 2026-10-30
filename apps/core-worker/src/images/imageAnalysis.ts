import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import { type ExifFacts, readExifFacts } from "./exif";
import { throughImagesBinding } from "./imagesBinding";
import { fetchPrivateImageSource } from "./imageTransform";
import { paletteFromPng } from "./palette";
import { renderSvgToPng } from "./wasm";

export interface ImageAnalysisResult {
  exif?: ExifFacts;
  height: number;
  palette: string[];
  width: number;
}

const readStoredExif = async (
  bucket: R2Bucket,
  sourceKey: string,
  etag: string,
  size: number
): Promise<ExifFacts | null> => {
  try {
    return await readExifFacts(async (offset, length) => {
      const object = await bucket.get(sourceKey, { range: { offset, length } });
      if (!object || object.httpEtag !== etag) {
        await object?.body.cancel();
        throw new OpFailure("source_changed");
      }
      return new Uint8Array(await object.arrayBuffer());
    }, size);
  } catch {
    return null;
  }
};

const isSvgSource = (key: string, contentType?: string): boolean =>
  contentType === "image/svg+xml" ||
  (key.toLowerCase().endsWith(".svg") &&
    (contentType === "application/xml" || contentType === "text/xml"));

interface CloudflareImageInfo {
  height?: number;
  original?: { height?: number; width?: number };
  width?: number;
}

const positiveDimension = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const parseDimensions = (
  value: unknown
): {
  height: number;
  width: number;
} | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const info = value as CloudflareImageInfo;
  const width = positiveDimension(info.original?.width ?? info.width);
  const height = positiveDimension(info.original?.height ?? info.height);
  return width && height ? { width, height } : null;
};

const analyzeSvg = async (
  env: Env,
  sourceKey: string
): Promise<ImageAnalysisResult> => {
  const object = await env.BUCKET.get(sourceKey);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  if (object.size > 10 * 1024 * 1024) {
    await object.body.cancel();
    throw new OpFailure("source_too_large");
  }
  const rendered = await renderSvgToPng(await object.text(), 64);
  return {
    height: rendered.originalHeight,
    palette: paletteFromPng(rendered.bytes),
    width: rendered.originalWidth,
  };
};

const dimensionsFromBinding = (
  env: Env,
  sourceKey: string,
  sourceSize: number
): Promise<{ height: number; width: number } | null> =>
  throughImagesBinding(
    env.IMAGES,
    sourceSize,
    async () => {
      const object = await env.BUCKET.get(sourceKey);
      if (!object) {
        throw new OpFailure("source_not_found");
      }
      return object;
    },
    async (images, object) => parseDimensions(await images.info(object.body))
  );

const resolveRasterDimensions = async (
  env: Env,
  sourceKey: string,
  sourceSize: number,
  origin: string,
  imageFetch: typeof fetch,
  now: number
): Promise<{ height: number; width: number }> => {
  const bindingDimensions = await dimensionsFromBinding(
    env,
    sourceKey,
    sourceSize
  );
  if (bindingDimensions) {
    return bindingDimensions;
  }
  const response = await fetchPrivateImageSource(
    env,
    origin,
    sourceKey,
    { anim: false, format: "json" },
    imageFetch,
    now
  );
  if (!response.ok) {
    throw new OpFailure("image_transform_failed");
  }
  const dimensions = parseDimensions(
    (await response.json()) as CloudflareImageInfo
  );
  if (!dimensions) {
    throw new OpFailure("image_dimensions_missing");
  }
  return dimensions;
};

export const analyzeImage = async (
  env: Env,
  sourceKey: string,
  origin: string,
  imageFetch = fetch,
  now = Math.floor(Date.now() / 1000)
): Promise<ImageAnalysisResult> => {
  const metadata = await env.BUCKET.head(sourceKey);
  if (!metadata) {
    throw new OpFailure("source_not_found");
  }
  if (isSvgSource(sourceKey, metadata.httpMetadata?.contentType)) {
    return await analyzeSvg(env, sourceKey);
  }

  const [dimensions, sampleResponse, exif] = await Promise.all([
    resolveRasterDimensions(
      env,
      sourceKey,
      metadata.size,
      origin,
      imageFetch,
      now
    ),
    fetchPrivateImageSource(
      env,
      origin,
      sourceKey,
      {
        anim: false,
        fit: "scale-down",
        format: "png",
        height: 64,
        metadata: "none",
        width: 64,
      },
      imageFetch,
      now
    ),
    readStoredExif(env.BUCKET, sourceKey, metadata.httpEtag, metadata.size),
  ]);
  if (!sampleResponse.ok) {
    throw new OpFailure("image_transform_failed");
  }
  return {
    ...dimensions,
    ...(exif ? { exif } : {}),
    palette: paletteFromPng(new Uint8Array(await sampleResponse.arrayBuffer())),
  };
};
