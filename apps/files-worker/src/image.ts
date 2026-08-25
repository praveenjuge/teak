// Edge image processing for the process-image op: decodes a card image
// straight from the R2 binding (raster via photon, HEIC via libheif, SVG via
// resvg), applies EXIF orientation, and in a single pass writes bounded
// lossy-WebP thumbnail + preview derivatives back to R2, returning dimensions,
// dominant-color palette, EXIF facts, and a thumbhash placeholder.
//
// This is the canonical image-byte processing path, including the quality-tier
// table and the small-image skip rule.

import {
  fliph,
  flipv,
  PhotonImage,
  resize,
  rotate,
  SamplingFilter,
} from "@cf-wasm/photon";
import { FILES_PROCESSOR_VERSION } from "@teak/files-protocol";
import { orientation as exifOrientationOf, parse as exifParse } from "exifr";
import { rgbaToThumbHash } from "thumbhash";
import {
  decodeHeicToRgba,
  encodeImageAsLossyWebp,
  renderSvgToPng,
} from "./wasm";

export const THUMBNAIL_MAX_WIDTH = 500;
export const THUMBNAIL_MAX_HEIGHT = 500;

/** Largest edge allowed for the preview derivative. */
export const PREVIEW_MAX_EDGE = 1600;
export const MAX_SVG_SOURCE_BYTES = 10 * 1024 * 1024;

// Workers have a hard memory ceiling; refuse very large originals instead of
// risking an OOM kill mid-decode.
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

// Photon expands rasters to RGBA buffers. Keep the largest decoded image well
// below the worker's 128 MB memory ceiling (source bytes and encoder buffers
// are live at the same time). This also prevents decompression-bomb images
// from reaching the WASM decoder.
export const MAX_DECODE_PIXELS = 16 * 1024 * 1024;

const MAX_COLORS = 5;
const SAMPLE_TARGET = 4000;
const CHANNEL_PRECISION = 16;

/** Longest edge of the image handed to the thumbhash encoder (must be ≤100). */
const THUMBHASH_MAX_EDGE = 64;

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

export class ImageDecodeFailed extends Error {
  constructor() {
    super("decode_failed");
  }
}

export interface ImageExifFacts {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  /** Capture time, epoch milliseconds (when present in the file). */
  takenAt?: number;
}

export interface ProcessImageResult {
  exif: ImageExifFacts | null;
  height: number;
  palette: string[];
  /** Set only when a larger preview derivative was written. */
  previewGenerated: boolean;
  previewKey: string | null;
  provenance: {
    generatedAt: number;
    processorVersion: string;
    sourceEtag: string;
    transformVersion: string;
  };
  thumbhash: string | null;
  thumbnailGenerated: boolean;
  /** Set only when a thumbnail was written; echoes the destination key. */
  thumbnailKey: string | null;
  width: number;
}

/**
 * Determine output quality based on file size. Aggressive compression keeps
 * thumbnails smaller than originals. Must stay in lockstep with
 * Keep this stable so provenance can identify transform changes.
 *
 * Quality is now honored end-to-end: thumbnails are encoded with libwebp's
 * lossy encoder (photon's WebP output was lossless and ignored this table).
 */
export const getOutputQuality = (fileSizeBytes: number): number => {
  if (fileSizeBytes < 1_000_000) {
    return 80;
  }
  if (fileSizeBytes < 2_000_000) {
    return 70;
  }
  if (fileSizeBytes < 5_000_000) {
    return 65;
  }
  if (fileSizeBytes < 20_000_000) {
    return 60;
  }
  // >= 20MB - maximum compression
  return 50;
};

/**
 * Files under 500KB that already fit inside the thumbnail box are considered
 * optimized; skip generating a duplicate.
 */
export const shouldSkipThumbnail = (
  fileSizeBytes: number,
  width: number,
  height: number
): boolean =>
  fileSizeBytes < 500_000 &&
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

const readSource = async (
  bucket: R2Bucket,
  key: string
): Promise<{ bytes: Uint8Array; etag: string }> => {
  const object = await bucket.get(key);
  if (!object) {
    throw new ImageSourceMissing();
  }
  if ((object.size ?? 0) > MAX_INPUT_BYTES) {
    await object.body.cancel();
    throw new ImageTooLarge();
  }
  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    etag: object.httpEtag,
  };
};

const TRANSFORM_VERSION = "image-v2";

const resultKeyFor = (srcKey: string): string => `${srcKey}.processing.json`;

const readCurrentResult = async (
  bucket: R2Bucket,
  srcKey: string,
  sourceEtag: string,
  destKey: string | null,
  previewDestKey: string | null
): Promise<ProcessImageResult | null> => {
  const stored = await bucket.get(resultKeyFor(srcKey));
  if (!stored) {
    return null;
  }
  try {
    const result = (await stored.json()) as ProcessImageResult;
    if (
      result.provenance?.processorVersion !== FILES_PROCESSOR_VERSION ||
      result.provenance.sourceEtag !== sourceEtag ||
      result.provenance.transformVersion !== TRANSFORM_VERSION
    ) {
      return null;
    }
    if (
      result.thumbnailGenerated &&
      !(destKey && (await bucket.head(destKey)))
    ) {
      return null;
    }
    if (
      result.previewGenerated &&
      !(previewDestKey && (await bucket.head(previewDestKey)))
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Input sniffing — the worker accepts rasters, HEIC, and SVG on the same
 * op so Convex does not need per-format signing variations.
 * ------------------------------------------------------------------ */

const HEIC_BRANDS = [
  "heic",
  "heix",
  "heim",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "heif",
];

export type DetectedImageFormat = "heic" | "raster" | "svg";

interface ImageDimensions {
  height: number;
  width: number;
}

const isJpegStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** Read dimensions without asking Photon to allocate the decoded pixel buffer. */
export const readRasterDimensions = (
  bytes: Uint8Array
): ImageDimensions | null => {
  // PNG: signature, then IHDR width/height.
  if (
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .every(
        (value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]
      ) &&
    bytes[12] === 73 &&
    bytes[13] === 72 &&
    bytes[14] === 68 &&
    bytes[15] === 82
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { height: view.getUint32(20), width: view.getUint32(16) };
  }

  // GIF stores its logical screen dimensions as little-endian uint16 values.
  if (
    bytes.length >= 10 &&
    (new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" ||
      new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a")
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { height: view.getUint16(8, true), width: view.getUint16(6, true) };
  }

  // JPEG dimensions are carried by a Start Of Frame segment. Walk segments
  // defensively so truncated or malformed files simply fall through to the
  // decoder's typed failure instead of throwing while sniffing.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        return null;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset += 1;
      }
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xd9 || marker === 0xda) {
        break;
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        continue;
      }
      if (offset + 1 >= bytes.length) {
        return null;
      }
      const segmentLength = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        2
      ).getUint16(0);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        return null;
      }
      if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset + offset,
          segmentLength
        );
        return { height: view.getUint16(3), width: view.getUint16(5) };
      }
      offset += segmentLength;
    }
  }

  // WebP extended headers expose dimensions directly. VP8/VP8L are left to
  // Photon because their compact bit layouts are not needed for the guard.
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    bytes[12] === 0x56
  ) {
    const width =
      1 + bytes[24] + (bytes[25] ?? 0) * 256 + (bytes[26] ?? 0) * 65_536;
    const height =
      1 + bytes[27] + (bytes[28] ?? 0) * 256 + (bytes[29] ?? 0) * 65_536;
    return { height, width };
  }

  return null;
};

const enforceDecodedPixelBudget = (
  dimensions: ImageDimensions | null
): void => {
  if (!dimensions) {
    return;
  }
  const { height, width } = dimensions;
  if (
    !(Number.isSafeInteger(width) && Number.isSafeInteger(height)) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_DECODE_PIXELS / height
  ) {
    throw new ImageTooLarge();
  }
};

export const detectImageFormat = (
  bytes: Uint8Array,
  maxSvgBytes = MAX_SVG_SOURCE_BYTES
): DetectedImageFormat => {
  // ISOBMFF: fourcc size bytes then "ftyp" then a major brand.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 && // p
    HEIC_BRANDS.includes(
      String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    )
  ) {
    return "heic";
  }

  // SVG: text prolog within the first kilobyte. Binary formats never begin
  // with a NUL-free run matching the XML/SVG pattern.
  const probe = bytes.subarray(0, 1024);
  if (
    probe.length > 0 &&
    probe.length <= maxSvgBytes &&
    !probe.slice(0, Math.min(probe.length, 16)).includes(0)
  ) {
    const text = new TextDecoder().decode(probe).replace(/^\uFEFF/, "");
    if (/<\?xml|<svg[\s>]/i.test(text)) {
      return "svg";
    }
  }

  return "raster";
};

const decodeSource = async (
  format: DetectedImageFormat,
  bytes: Uint8Array
): Promise<{ decoded: PhotonImage; sourceForExif: Uint8Array }> => {
  if (format === "svg") {
    try {
      const png = await renderSvgToPng(new TextDecoder().decode(bytes));
      return {
        decoded: PhotonImage.new_from_byteslice(png.bytes),
        sourceForExif: bytes,
      };
    } catch {
      throw new ImageDecodeFailed();
    }
  }

  if (format === "heic") {
    let rgba: { pixels: Uint8Array; width: number; height: number };
    try {
      rgba = await decodeHeicToRgba(bytes);
    } catch {
      throw new ImageDecodeFailed();
    }
    enforceDecodedPixelBudget(rgba);
    return {
      decoded: new PhotonImage(rgba.pixels, rgba.width, rgba.height),
      sourceForExif: bytes,
    };
  }

  enforceDecodedPixelBudget(readRasterDimensions(bytes));
  try {
    return {
      decoded: PhotonImage.new_from_byteslice(bytes),
      sourceForExif: bytes,
    };
  } catch {
    throw new ImageDecodeFailed();
  }
};

const extractExifFacts = async (
  bytes: Uint8Array
): Promise<ImageExifFacts | null> => {
  try {
    const parsed = (await exifParse(
      bytes.buffer instanceof ArrayBuffer ? bytes.buffer : bytes.slice().buffer,
      {
        pick: [
          "DateTimeOriginal",
          "ExposureTime",
          "FNumber",
          "FocalLength",
          "ISO",
          "Latitude",
          "Longitude",
          "Make",
          "Model",
        ],
      }
    )) as Record<string, unknown> | undefined;
    if (!parsed) {
      return null;
    }

    const facts: ImageExifFacts = {};
    if (typeof parsed.Make === "string" && parsed.Make.trim()) {
      facts.make = parsed.Make.trim();
    }
    if (typeof parsed.Model === "string" && parsed.Model.trim()) {
      facts.model = parsed.Model.trim();
    }
    if (parsed.DateTimeOriginal instanceof Date) {
      const time = parsed.DateTimeOriginal.getTime();
      if (Number.isFinite(time)) {
        facts.takenAt = time;
      }
    }
    if (typeof parsed.ExposureTime === "number" && parsed.ExposureTime > 0) {
      facts.exposureTime = parsed.ExposureTime;
    }
    if (typeof parsed.FNumber === "number" && parsed.FNumber > 0) {
      facts.fNumber = parsed.FNumber;
    }
    if (typeof parsed.ISO === "number" && parsed.ISO > 0) {
      facts.iso = parsed.ISO;
    }
    if (typeof parsed.FocalLength === "number" && parsed.FocalLength > 0) {
      facts.focalLength = parsed.FocalLength;
    }
    if (
      typeof parsed.Latitude === "number" &&
      typeof parsed.Longitude === "number" &&
      Number.isFinite(parsed.Latitude) &&
      Number.isFinite(parsed.Longitude)
    ) {
      facts.latitude = parsed.Latitude;
      facts.longitude = parsed.Longitude;
    }
    return Object.keys(facts).length > 0 ? facts : null;
  } catch {
    return null;
  }
};

interface DerivedTarget {
  maxHeight: number;
  maxWidth: number;
}

/** Largest width/height preserving the aspect ratio within the bounds. */
const computeFit = (
  aspectRatio: number,
  { maxHeight, maxWidth }: DerivedTarget
): { height: number; width: number } => {
  let targetWidth: number;
  let targetHeight: number;

  if (aspectRatio > 1) {
    targetWidth = maxWidth;
    targetHeight = Math.max(1, Math.round(targetWidth / aspectRatio));
  } else {
    targetHeight = maxHeight;
    targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
  }
  if (targetWidth > maxWidth) {
    targetWidth = maxWidth;
    targetHeight = Math.max(1, Math.round(targetWidth / aspectRatio));
  }
  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
  }
  return { height: Math.max(1, targetHeight), width: Math.max(1, targetWidth) };
};

// The Photon WASM module is isolate-global and retains Rust-owned image state
// across awaits. Serializing image lifetimes avoids overlapping large decode /
// resize / free sequences, which otherwise can trigger wasm-bindgen borrow
// panics under concurrent requests.
let imageProcessingTail = Promise.resolve();

const withImageProcessingLock = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const previous = imageProcessingTail;
  let release!: () => void;
  imageProcessingTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const isPhotonFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === "Invalid array buffer length" ||
    error.message ===
      "attempted to take ownership of Rust value while it was borrowed");

/**
 * Run the combined decode → orient → derive pipeline.
 *
 * @param destKey when non-null and generation is not skipped, the thumbnail
 *   lossy WebP is written here with its content type stored as httpMetadata.
 * @param opts.previewDestKey when non-null and the original exceeds the
 *   preview bounds, an additional bounded preview is written there.
 */
const processImageUnlocked = async (
  bucket: R2Bucket,
  srcKey: string,
  destKey: string | null,
  opts?: { previewDestKey?: string | null }
): Promise<ProcessImageResult> => {
  const source = await readSource(bucket, srcKey);
  const sourceBytes = source.bytes;
  const previewDestKey = opts?.previewDestKey ?? null;
  const current = await readCurrentResult(
    bucket,
    srcKey,
    source.etag,
    destKey,
    previewDestKey
  );
  if (current) {
    return current;
  }
  const format = detectImageFormat(sourceBytes);
  const { decoded, sourceForExif } = await decodeSource(format, sourceBytes);

  const exifOrientationValue = await exifOrientationOf(
    sourceForExif.buffer instanceof ArrayBuffer
      ? sourceForExif.buffer
      : sourceForExif.slice().buffer
  ).catch(() => undefined);

  const oriented = applyExifOrientation(decoded, exifOrientationValue ?? 1);
  const width = oriented.get_width();
  const height = oriented.get_height();
  const fileSizeBytes = sourceBytes.byteLength;

  const quality = getOutputQuality(fileSizeBytes);
  const skipThumbnail =
    destKey === null || shouldSkipThumbnail(fileSizeBytes, width, height);

  const aspectRatio = width / height;
  let thumbnailGenerated = false;
  let paletteSource: PhotonImage = oriented;
  let palette: string[] | null = null;

  try {
    if (!skipThumbnail && destKey) {
      const fit = computeFit(aspectRatio, {
        maxHeight: THUMBNAIL_MAX_HEIGHT,
        maxWidth: THUMBNAIL_MAX_WIDTH,
      });

      // Triangle (bilinear) avoids the aliasing/shimmer artifacts that Nearest
      // introduces on downscales, at a similar encode size.
      const outputImage = resize(
        oriented,
        fit.width,
        fit.height,
        SamplingFilter.Triangle
      );
      paletteSource = outputImage;

      const rawPixels = outputImage.get_raw_pixels();
      const outputBytes = await encodeImageAsLossyWebp(
        rawPixels,
        fit.width,
        fit.height,
        quality
      );
      const blob = new Blob([outputBytes], { type: "image/webp" });
      await bucket.put(destKey, blob, {
        httpMetadata: { contentType: "image/webp" },
      });
      thumbnailGenerated = true;
      palette = computePalette(rawPixels, MAX_COLORS);
    }

    // Preview derivative for originals beyond the preview bounds.
    let previewGenerated = false;
    if (
      previewDestKey &&
      (width > PREVIEW_MAX_EDGE || height > PREVIEW_MAX_EDGE)
    ) {
      const previewFit = computeFit(aspectRatio, {
        maxHeight: PREVIEW_MAX_EDGE,
        maxWidth: PREVIEW_MAX_EDGE,
      });
      const previewImage = resize(
        oriented,
        previewFit.width,
        previewFit.height,
        SamplingFilter.Triangle
      );
      try {
        const previewRaw = previewImage.get_raw_pixels();
        const previewBytes = await encodeImageAsLossyWebp(
          previewRaw,
          previewFit.width,
          previewFit.height,
          Math.max(quality, 75)
        );
        const blob = new Blob([previewBytes], { type: "image/webp" });
        await bucket.put(previewDestKey, blob, {
          httpMetadata: { contentType: "image/webp" },
        });
        previewGenerated = true;
        palette ??= computePalette(previewRaw, MAX_COLORS);
      } finally {
        previewImage.free();
      }
    }

    // Palette fallback for skipped thumbnails (already-small images).
    palette ??= computePalette(paletteSource.get_raw_pixels(), MAX_COLORS);

    // Thumbhash placeholder from a tiny re-render of whichever image we have.
    let thumbhash: string | null = null;
    try {
      const hashFit = computeFit(aspectRatio, {
        maxHeight: THUMBHASH_MAX_EDGE,
        maxWidth: THUMBHASH_MAX_EDGE,
      });
      const hashImage =
        hashFit.width === paletteSource.get_width() &&
        hashFit.height === paletteSource.get_height()
          ? paletteSource
          : resize(
              oriented,
              hashFit.width,
              hashFit.height,
              SamplingFilter.Triangle
            );
      try {
        const hashBytes = rgbaToThumbHash(
          hashImage.get_width(),
          hashImage.get_height(),
          hashImage.get_raw_pixels()
        );
        thumbhash = btoa(
          Array.from(hashBytes, (byte) => String.fromCharCode(byte)).join("")
        );
      } finally {
        if (hashImage !== paletteSource) {
          hashImage.free();
        }
      }
    } catch {
      // Placeholder generation is best-effort.
      thumbhash = null;
    }

    const exif =
      format === "raster" || format === "heic"
        ? await extractExifFacts(sourceForExif)
        : null;

    const result: ProcessImageResult = {
      exif,
      height,
      palette: palette ?? [],
      previewGenerated,
      previewKey: previewGenerated && previewDestKey ? previewDestKey : null,
      thumbhash,
      thumbnailGenerated,
      thumbnailKey: thumbnailGenerated && destKey ? destKey : null,
      provenance: {
        generatedAt: Date.now(),
        processorVersion: FILES_PROCESSOR_VERSION,
        sourceEtag: source.etag,
        transformVersion: TRANSFORM_VERSION,
      },
      width,
    };
    await bucket.put(
      resultKeyFor(srcKey),
      new Blob([JSON.stringify(result)], { type: "application/json" }),
      {
        httpMetadata: { contentType: "application/json" },
      }
    );
    return result;
  } finally {
    // Release WASM-owned pixel buffers promptly; workers have a tight memory
    // ceiling and these can be tens of megabytes for large originals.
    try {
      if (paletteSource !== oriented) {
        paletteSource.free();
      }
    } finally {
      try {
        oriented.free();
      } finally {
        // Rotations return a new PhotonImage and leave the decoded source
        // allocated. Release that source as well; flips keep the same object.
        if (decoded !== oriented) {
          decoded.free();
        }
      }
    }
  }
};

export const processImage = (
  bucket: R2Bucket,
  srcKey: string,
  destKey: string | null,
  opts?: { previewDestKey?: string | null }
): Promise<ProcessImageResult> =>
  withImageProcessingLock(async () => {
    try {
      return await processImageUnlocked(bucket, srcKey, destKey, opts);
    } catch (error) {
      // Photon reports malformed/unsupported raster bytes as low-level WASM
      // exceptions. Convert those into the same controlled fallback as an
      // explicit decode failure instead of reporting a user-input 500.
      if (isPhotonFailure(error)) {
        throw new ImageDecodeFailed();
      }
      throw error;
    }
  });
