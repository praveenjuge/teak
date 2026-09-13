/** Image dimension parsers. Malformed input returns null; callers fall back to a weaker verification level. */

import { ascii, u16be, u32be, u32le } from "./mediaBytes";
import { isBmp, isGif, isJpeg, isPng, isTiff, isWebp } from "./mediaDetect";

export const parsePngDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (bytes.length < 33 || !isPng(bytes) || ascii(bytes, 12, 4) !== "IHDR") {
    return null;
  }
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  return width > 0 && height > 0 ? { height, width } : null;
};

export const parseGifDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (bytes.length < 10 || !isGif(bytes)) {
    return null;
  }
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  return width > 0 && height > 0 ? { height, width } : null;
};

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const parseJpegDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (!isJpeg(bytes)) {
    return null;
  }
  let offset = 2;
  for (let segments = 0; segments < 64; segments += 1) {
    if (offset + 4 > bytes.length) {
      return null;
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
      if (offset + 2 > bytes.length) {
        return null;
      }
    }
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      return null;
    }
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) {
      return null;
    }
    if (JPEG_SOF_MARKERS.has(marker) && length >= 7) {
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      return width > 0 && height > 0 ? { height, width } : null;
    }
    offset += length;
  }
  return null;
};

export const parseWebpDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (bytes.length < 30 || !isWebp(bytes)) {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width =
      1 + (bytes[24] ?? 0) + (bytes[25] ?? 0) * 256 + (bytes[26] ?? 0) * 65_536;
    const height =
      1 + (bytes[27] ?? 0) + (bytes[28] ?? 0) * 256 + (bytes[29] ?? 0) * 65_536;
    return width > 0 && height > 0 ? { height, width } : null;
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const byte0 = bytes[21] ?? 0;
    const byte1 = bytes[22] ?? 0;
    const byte2 = bytes[23] ?? 0;
    const byte3 = bytes[24] ?? 0;
    const width = byte0 + (byte1 % 64) * 256 + 1;
    const height = Math.floor(byte1 / 64) + byte2 * 4 + (byte3 % 16) * 1024 + 1;
    return { height, width };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01) {
    const width = (((bytes[27] ?? 0) << 8) | (bytes[26] ?? 0)) % 16_384;
    const height = (((bytes[29] ?? 0) << 8) | (bytes[28] ?? 0)) % 16_384;
    return width > 0 && height > 0 ? { height, width } : null;
  }
  return null;
};

export const parseBmpDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (bytes.length < 26 || !isBmp(bytes)) {
    return null;
  }
  const width = u32le(bytes, 18);
  const height = Math.abs(
    (u32le(bytes, 22) | 0) >= 0 ? u32le(bytes, 22) : u32le(bytes, 22) | 0
  );
  return width > 0 && height > 0 ? { height, width } : null;
};

export const parseTiffDimensions = (
  bytes: Uint8Array
): { height: number; width: number } | null => {
  if (bytes.length < 8 || !isTiff(bytes)) {
    return null;
  }
  const little = bytes[0] === 0x49;
  const u16 = (offset: number): number =>
    little
      ? (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
      : u16be(bytes, offset);
  const u32 = (offset: number): number =>
    little ? u32le(bytes, offset) : u32be(bytes, offset);
  const ifdOffset = u32(4);
  if (ifdOffset + 2 > bytes.length || ifdOffset > 65_536) {
    return null;
  }
  const entries = u16(ifdOffset);
  if (entries > 64 || ifdOffset + 2 + entries * 12 > bytes.length) {
    return null;
  }
  let width = 0;
  let height = 0;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    const tag = u16(entry);
    if (tag === 256) {
      width = u32(entry + 8);
    } else if (tag === 257) {
      height = u32(entry + 8);
    }
  }
  return width > 0 && height > 0 ? { height, width } : null;
};
