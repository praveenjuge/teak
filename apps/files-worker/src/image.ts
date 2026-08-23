// Edge image processing for the process-image op: decodes a card's original
// raster image straight from the R2 binding, applies EXIF orientation,
// optionally writes a bounded WebP thumbnail back to R2, and returns original
// dimensions plus a dominant-color palette — all in one pass.
//
// Logic mirrors packages/convex/workflows/steps/renderables/generateThumbnail.ts
// and steps/palette.ts (the legacy Convex action fallback paths), including
// the quality-tier table and the small-image skip rule.

import {
  fliph,
  flipv,
  PhotonImage,
  resize,
  rotate,
  SamplingFilter,
} from "@cf-wasm/photon";
import { orientation } from "exifr";

export const THUMBNAIL_MAX_WIDTH = 500;
export const THUMBNAIL_MAX_HEIGHT = 500;

// Workers have a hard memory ceiling well below Convex actions; refuse very
// large originals so callers can fall back to the legacy action path instead
// of risking an OOM kill mid-decode.
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

const MAX_COLORS = 5;
const SAMPLE_TARGET = 4000;
const CHANNEL_PRECISION = 16;

export class ImageSourceMissing extends Error {
  constructor() {
    super("source_not_found");
  }
}

export class ImageTooLarge extends Error {
  constructor() {
    super("source_too_large");
  }
}

export interface ProcessImageResult {
  height: number;
  palette: string[];
  thumbnailGenerated: boolean;
  /** Set only when a thumbnail was written; echoes the destination key. */
  thumbnailKey: string | null;
  width: number;
}

interface OutputSettings {
  quality: number;
  skipThumbnail: boolean;
  useJpeg: boolean;
}

/**
 * Determine output quality and format based on file size. Aggressive
 * compression keeps thumbnails smaller than originals. Must stay in lockstep
 * with generateThumbnail.ts in the Convex package.
 */
export const getOutputSettings = (fileSizeBytes: number): OutputSettings => {
  // Skip thumbnail generation for very small files (< 500KB) - they're already optimized
  if (fileSizeBytes < 500_000) {
    return { quality: 100, useJpeg: false, skipThumbnail: true };
  }

  if (fileSizeBytes < 1_000_000) {
    // < 1MB - good WebP compression
    return { quality: 80, useJpeg: false, skipThumbnail: false };
  }
  if (fileSizeBytes < 2_000_000) {
    return { quality: 70, useJpeg: false, skipThumbnail: false };
  }
  if (fileSizeBytes < 5_000_000) {
    return { quality: 65, useJpeg: false, skipThumbnail: false };
  }
  if (fileSizeBytes < 10_000_000) {
    return { quality: 60, useJpeg: false, skipThumbnail: false };
  }
  if (fileSizeBytes < 20_000_000) {
    return { quality: 60, useJpeg: false, skipThumbnail: false };
  }
  // >= 20MB - maximum WebP compression
  return { quality: 50, useJpeg: false, skipThumbnail: false };
};

export const shouldSkipThumbnail = (
  fileSizeBytes: number,
  width: number,
  height: number
): boolean =>
  getOutputSettings(fileSizeBytes).skipThumbnail &&
  width <= THUMBNAIL_MAX_WIDTH &&
  height <= THUMBNAIL_MAX_HEIGHT;

/**
 * Apply EXIF orientation to fix iOS HEIC-exports' rotation. Values follow the
 * EXIF spec (2=flip-h, 3=180°, 4=flip-v, 5/7=transpose variants, 6=90° CW,
 * 8=270° CW). Mirrors applyExifOrientation in generateThumbnail.ts.
 */
const applyExifOrientation = (
  image: PhotonImage,
  orientationValue: number
): PhotonImage => {
  let resultImage = image;

  switch (orientationValue) {
    case 2:
      fliph(resultImage);
      break;
    case 3:
      resultImage = rotate(resultImage, 180);
      break;
    case 4:
      flipv(resultImage);
      break;
    case 5:
      fliph(resultImage);
      resultImage = rotate(resultImage, 270);
      break;
    case 6:
      resultImage = rotate(resultImage, 90);
      break;
    case 7:
      fliph(resultImage);
      resultImage = rotate(resultImage, 90);
      break;
    case 8:
      resultImage = rotate(resultImage, 270);
      break;
    default:
      // No transformation needed
      break;
  }

  return resultImage;
};

const quantizeChannel = (value: number): number => {
  const clamped = Math.max(0, Math.min(255, value));
  const bucket = Math.round(clamped / CHANNEL_PRECISION) * CHANNEL_PRECISION;
  return Math.max(0, Math.min(255, bucket));
};

const toHex = (value: number): string => value.toString(16).padStart(2, "0");
const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();

/** Dominant-color extraction over RGBA pixels. Mirrors palette.ts. */
export const computePalette = (
  pixels: Uint8Array,
  maxColors: number
): string[] => {
  if (!pixels.length) {
    return [];
  }

  const pixelCount = Math.floor(pixels.length / 4);
  if (!pixelCount) {
    return [];
  }

  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_TARGET));
  const colorCounts = new Map<string, number>();

  for (let i = 0; i < pixelCount; i += stride) {
    const offset = i * 4;
    const alpha = pixels[offset + 3];
    if (alpha < 16) {
      continue;
    }

    const r = quantizeChannel(pixels[offset]);
    const g = quantizeChannel(pixels[offset + 1]);
    const b = quantizeChannel(pixels[offset + 2]);
    const hex = rgbToHex(r, g, b);
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  if (!colorCounts.size) {
    const [r = 0, g = 0, b = 0] = pixels;
    return [rgbToHex(r, g, b)];
  }

  return [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
};

const readSourceBytes = async (
  bucket: R2Bucket,
  key: string
): Promise<{ bytes: Uint8Array; httpMetadata?: R2HTTPMetadata }> => {
  const object = await bucket.get(key);
  if (!object) {
    throw new ImageSourceMissing();
  }
  if ((object.size ?? 0) > MAX_INPUT_BYTES) {
    await object.body.cancel();
    throw new ImageTooLarge();
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { bytes, httpMetadata: object.httpMetadata };
};

/**
 * Run the combined decode → orient → resize → encode pipeline.
 *
 * @param destKey when non-null and generation is not skipped, the thumbnail
 *   WebP is written here with its content type stored as httpMetadata so the
 *   download path serves it correctly even without ct overrides.
 */
export const processImage = async (
  bucket: R2Bucket,
  srcKey: string,
  destKey: string | null
): Promise<ProcessImageResult> => {
  const source = await readSourceBytes(bucket, srcKey);

  let decoded: PhotonImage;
  try {
    decoded = PhotonImage.new_from_byteslice(source.bytes);
  } catch {
    throw new Error("decode_failed");
  }

  const exifOrientationValue = await orientation(
    source.bytes.buffer instanceof ArrayBuffer
      ? source.bytes.buffer
      : source.bytes.slice().buffer
  ).catch(() => undefined);

  const oriented = applyExifOrientation(decoded, exifOrientationValue ?? 1);
  const width = oriented.get_width();
  const height = oriented.get_height();
  const fileSizeBytes = source.bytes.byteLength;

  const settings = getOutputSettings(fileSizeBytes);
  const skipThumbnail =
    destKey === null || shouldSkipThumbnail(fileSizeBytes, width, height);

  let thumbnailGenerated = false;
  let paletteSource: PhotonImage = oriented;

  if (!skipThumbnail && destKey) {
    // Triangle (bilinear) avoids the aliasing/shimmer artifacts that Nearest
    // introduces on downscales, at a similar encode size.
    const aspectRatio = width / height;
    let targetWidth: number;
    let targetHeight: number;

    if (aspectRatio > 1) {
      targetWidth = Math.min(width, THUMBNAIL_MAX_WIDTH);
      targetHeight = Math.max(1, Math.round(targetWidth / aspectRatio));
    } else {
      targetHeight = Math.min(height, THUMBNAIL_MAX_HEIGHT);
      targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
    }
    if (targetWidth > THUMBNAIL_MAX_WIDTH) {
      targetWidth = THUMBNAIL_MAX_WIDTH;
      targetHeight = Math.max(1, Math.round(targetWidth / aspectRatio));
    }
    if (targetHeight > THUMBNAIL_MAX_HEIGHT) {
      targetHeight = THUMBNAIL_MAX_HEIGHT;
      targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
    }

    const outputImage = resize(
      oriented,
      targetWidth,
      targetHeight,
      SamplingFilter.Triangle
    );
    paletteSource = outputImage;

    const outputBytes = settings.useJpeg
      ? outputImage.get_bytes_jpeg(settings.quality)
      : outputImage.get_bytes_webp();
    const contentType = settings.useJpeg ? "image/jpeg" : "image/webp";
    const blob = new Blob([outputBytes], { type: contentType });

    await bucket.put(destKey, blob, {
      httpMetadata: { contentType },
    });
    thumbnailGenerated = true;
  }

  const rawPixels = paletteSource.get_raw_pixels();
  const palette = computePalette(rawPixels, MAX_COLORS);

  // Release WASM-owned pixel buffers promptly; workers have a tight memory
  // ceiling and these can be tens of megabytes for large originals.
  try {
    if (paletteSource !== oriented) {
      paletteSource.free();
    }
  } finally {
    oriented.free();
  }

  return {
    width,
    height,
    thumbnailGenerated,
    thumbnailKey: thumbnailGenerated && destKey ? destKey : null,
    palette,
  };
};
