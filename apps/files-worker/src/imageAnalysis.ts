import { fetchPrivateImageSource } from "./imageTransform";
import type { Env } from "./index";
import { paletteFromPng } from "./palette";
import { renderSvgToPng } from "./wasm";

export interface ImageAnalysisResult {
  height: number;
  palette: string[];
  width: number;
}

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
  value: CloudflareImageInfo
): {
  height: number;
  width: number;
} | null => {
  const width = positiveDimension(value.original?.width ?? value.width);
  const height = positiveDimension(value.original?.height ?? value.height);
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

  const [infoResponse, sampleResponse] = await Promise.all([
    fetchPrivateImageSource(
      env,
      origin,
      sourceKey,
      { anim: false, format: "json" },
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
  if (!(infoResponse.ok && sampleResponse.ok)) {
    throw new Error("image_transform_failed");
  }
  const dimensions = parseDimensions(
    (await infoResponse.json()) as CloudflareImageInfo
  );
  if (!dimensions) {
    throw new Error("image_dimensions_missing");
  }
  return {
    ...dimensions,
    palette: paletteFromPng(new Uint8Array(await sampleResponse.arrayBuffer())),
  };
};
