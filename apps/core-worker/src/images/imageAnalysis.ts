import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import { type ExifFacts, readExifFacts } from "./exif";
import { imageInfoFromBinding, imageInfoFromUrlProbe } from "./imageFacts";
import { fetchPrivateImageSource } from "./imageTransform";
import { paletteFromPng } from "./palette";
import { isSvgObject, renderStoredSvg } from "./svg";

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

const analyzeSvg = async (
  env: Env,
  sourceKey: string
): Promise<ImageAnalysisResult> => {
  const rendered = await renderStoredSvg(env.BUCKET, sourceKey, 64);
  return {
    height: rendered.originalHeight,
    palette: paletteFromPng(rendered.bytes),
    width: rendered.originalWidth,
  };
};

const resolveRasterDimensions = async (
  env: Env,
  sourceKey: string,
  source: { httpEtag: string; size: number },
  origin: string,
  imageFetch: typeof fetch,
  now: number
): Promise<{ height: number; width: number }> => {
  const bindingInfo = await imageInfoFromBinding(env, sourceKey, source);
  if (bindingInfo?.width && bindingInfo.height) {
    return { height: bindingInfo.height, width: bindingInfo.width };
  }
  const probed = await imageInfoFromUrlProbe(
    env,
    sourceKey,
    origin,
    imageFetch,
    now
  );
  if (!probed) {
    throw new OpFailure("image_transform_failed");
  }
  if (!(probed.width && probed.height)) {
    throw new OpFailure("image_dimensions_missing");
  }
  return { height: probed.height, width: probed.width };
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
  if (isSvgObject(sourceKey, metadata.httpMetadata?.contentType)) {
    return await analyzeSvg(env, sourceKey);
  }

  const [dimensions, sampleResponse, exif] = await Promise.all([
    resolveRasterDimensions(env, sourceKey, metadata, origin, imageFetch, now),
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
