import { fetchPrivateImageSource } from "./imageTransform";
import type { Env } from "./index";
import { paletteFromPng } from "./palette";
import { renderSvgToPng } from "./wasm";

export interface ImageAnalysisResult {
  height: number;
  palette: string[];
  width: number;
}

// Cloudflare's Images binding accepts raw inputs up to 20 MB. Larger images
// retain the URL-transformation metadata fallback, whose remote-image limit is
// higher and already covers Teak's upload ceiling.
const MAX_IMAGES_BINDING_INPUT_BYTES = 20 * 1024 * 1024;

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
    throw new Error("source_not_found");
  }
  if (object.size > 10 * 1024 * 1024) {
    await object.body.cancel();
    throw new Error("source_too_large");
  }
  const rendered = await renderSvgToPng(await object.text(), 64);
  return {
    height: rendered.originalHeight,
    palette: paletteFromPng(rendered.bytes),
    width: rendered.originalWidth,
  };
};

const dimensionsFromBinding = async (
  env: Env,
  sourceKey: string,
  sourceSize: number
): Promise<{ height: number; width: number } | null> => {
  if (!(env.IMAGES && sourceSize <= MAX_IMAGES_BINDING_INPUT_BYTES)) {
    return null;
  }
  const object = await env.BUCKET.get(sourceKey);
  if (!object) {
    throw new Error("source_not_found");
  }
  try {
    return parseDimensions(await env.IMAGES.info(object.body));
  } catch {
    // Binding metadata is an optimization, not a new failure mode. Preserve
    // the proven transformation fallback for unsupported or transient cases.
    try {
      await object.body.cancel();
    } catch {
      // The binding may already have locked or consumed the stream.
    }
    return null;
  }
};

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
    throw new Error("image_transform_failed");
  }
  const dimensions = parseDimensions(
    (await response.json()) as CloudflareImageInfo
  );
  if (!dimensions) {
    throw new Error("image_dimensions_missing");
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
    throw new Error("source_not_found");
  }
  if (isSvgSource(sourceKey, metadata.httpMetadata?.contentType)) {
    return await analyzeSvg(env, sourceKey);
  }

  const [dimensions, sampleResponse] = await Promise.all([
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
  ]);
  if (!sampleResponse.ok) {
    throw new Error("image_transform_failed");
  }
  return {
    ...dimensions,
    palette: paletteFromPng(new Uint8Array(await sampleResponse.arrayBuffer())),
  };
};
