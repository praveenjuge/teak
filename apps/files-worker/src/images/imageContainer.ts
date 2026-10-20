import { PhotonImage } from "@cf-wasm/photon";
import type { FilesFinalizeImageResult } from "@teak/files-protocol";

type ImageFacts = Pick<
  FilesFinalizeImageResult,
  "decodedFormat" | "height" | "width"
>;

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const hasBytes = (
  bytes: Uint8Array,
  start: number,
  expected: readonly number[]
): boolean => expected.every((value, index) => bytes[start + index] === value);

const positiveDimensions = (
  decodedFormat: string,
  width: number,
  height: number
): ImageFacts | null =>
  width > 0 && height > 0 ? { decodedFormat, height, width } : null;

const inspectPng = (bytes: Uint8Array): ImageFacts | null => {
  if (
    bytes.length < 45 ||
    !hasBytes(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions: ImageFacts | null = null;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      return null;
    }
    const type = ascii(bytes, offset + 4, 4);
    if (offset === 8 && (type !== "IHDR" || length !== 13)) {
      return null;
    }
    if (type === "IHDR") {
      dimensions = positiveDimensions(
        "image/png",
        view.getUint32(offset + 8),
        view.getUint32(offset + 12)
      );
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      return length === 0 && end === bytes.length && sawImageData
        ? dimensions
        : null;
    }
    offset = end;
  }
  return null;
};

const inspectGif = (bytes: Uint8Array): ImageFacts | null => {
  const header = ascii(bytes, 0, 6);
  if (
    bytes.length < 14 ||
    (header !== "GIF87a" && header !== "GIF89a") ||
    bytes.at(-1) !== 0x3b
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return positiveDimensions(
    "image/gif",
    view.getUint16(6, true),
    view.getUint16(8, true)
  );
};

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const inspectJpeg = (bytes: Uint8Array): ImageFacts | null => {
  if (
    bytes.length < 12 ||
    !hasBytes(bytes, 0, [0xff, 0xd8]) ||
    !hasBytes(bytes, bytes.length - 2, [0xff, 0xd9])
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xda || marker === 0xd9) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      return null;
    }
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      return positiveDimensions(
        "image/jpeg",
        view.getUint16(offset + 5),
        view.getUint16(offset + 3)
      );
    }
    offset += segmentLength;
  }
  return null;
};

const inspectWebp = (bytes: Uint8Array): ImageFacts | null => {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width =
      1 + (bytes[24] ?? 0) + (bytes[25] ?? 0) * 256 + (bytes[26] ?? 0) * 65_536;
    const height =
      1 + (bytes[27] ?? 0) + (bytes[28] ?? 0) * 256 + (bytes[29] ?? 0) * 65_536;
    return positiveDimensions("image/webp", width, height);
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const byte0 = bytes[21] ?? 0;
    const byte1 = bytes[22] ?? 0;
    const byte2 = bytes[23] ?? 0;
    const byte3 = bytes[24] ?? 0;
    return positiveDimensions(
      "image/webp",
      byte0 + (byte1 % 64) * 256 + 1,
      Math.floor(byte1 / 64) + byte2 * 4 + (byte3 % 16) * 1024 + 1
    );
  }
  if (chunk === "VP8 " && hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return positiveDimensions(
      "image/webp",
      view.getUint16(26, true) % 16_384,
      view.getUint16(28, true) % 16_384
    );
  }
  return null;
};

/**
 * Decode a complete, bounded image with Photon's WASM codec when Cloudflare's
 * two decoders reject a compatible edge case. Container parsing identifies
 * the format, but dimensions are trusted only after successful pixel decode.
 */
export const inspectImageContainer = (bytes: Uint8Array): ImageFacts | null => {
  const containerFacts =
    inspectPng(bytes) ??
    inspectGif(bytes) ??
    inspectJpeg(bytes) ??
    inspectWebp(bytes);
  if (!containerFacts) {
    return null;
  }
  let image: PhotonImage | null = null;
  try {
    image = PhotonImage.new_from_byteslice(bytes);
    const width = image.get_width();
    const height = image.get_height();
    return width > 0 && height > 0
      ? { decodedFormat: containerFacts.decodedFormat, height, width }
      : null;
  } catch {
    return null;
  } finally {
    image?.free();
  }
};
