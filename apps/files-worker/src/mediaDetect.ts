/** Signature predicates for upload verification. Predicates never throw: short input simply does not match. */

import { ascii, startsWith } from "./mediaBytes";

export const isPng = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);

export const isJpeg = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0xff, 0xd8, 0xff]);

export const isGif = (bytes: Uint8Array): boolean => {
  const header = ascii(bytes, 0, 6);
  return header === "GIF87a" || header === "GIF89a";
};

export const isWebp = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";

export const isBmp = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0x42, 0x4d]);

export const isTiff = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "II*\0" || ascii(bytes, 0, 4) === "MM\0*";

export const isIsobmff = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";

export const isEbml = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);

export const isMp3 = (bytes: Uint8Array): boolean => {
  if (ascii(bytes, 0, 3) === "ID3") {
    return true;
  }
  // MPEG frame sync: 11 set bits followed by a valid MPEG version/layer nibble.
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    ((bytes[1] ?? 0) & 0xe0) === 0xe0 &&
    ((bytes[1] ?? 0) & 0x18) !== 0x08 &&
    ((bytes[1] ?? 0) & 0x06) !== 0x00
  );
};

export const isWav = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";

export const isAvi = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ";

export const isOgg = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "OggS";

export const isFlac = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 4) === "fLaC";

export const isAacAdts = (bytes: Uint8Array): boolean =>
  bytes.length >= 7 &&
  bytes[0] === 0xff &&
  ((bytes[1] ?? 0) & 0xf6) === 0xf0 &&
  ((bytes[1] ?? 0) & 0x08) === 0x00;

export const isAsf = (bytes: Uint8Array): boolean =>
  startsWith(
    bytes,
    [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]
  );

export const isMpegTs = (bytes: Uint8Array): boolean =>
  bytes.length >= 376 &&
  bytes[0] === 0x47 &&
  bytes[188] === 0x47 &&
  bytes[376] === 0x47;

export const isMpegPs = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0x00, 0x00, 0x01, 0xba]);

export const isMatroska = (bytes: Uint8Array): boolean =>
  isEbml(bytes) && ascii(bytes, 0, 64).includes("matroska");

export const isWebm = (bytes: Uint8Array): boolean =>
  isEbml(bytes) && !isMatroska(bytes);

export const isPdf = (bytes: Uint8Array): boolean =>
  ascii(bytes, 0, 5) === "%PDF-";

export const isZip = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);

export const isOle = (bytes: Uint8Array): boolean =>
  startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const fontFormatOf = (
  bytes: Uint8Array
): "opentype" | "truetype" | "woff" | "woff2" | null => {
  const tag = ascii(bytes, 0, 4);
  if (tag === "OTTO" || tag === "ttcf") {
    return "opentype";
  }
  if (
    startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) ||
    tag === "true" ||
    tag === "typ1"
  ) {
    return "truetype";
  }
  if (tag === "wOFF") {
    return "woff";
  }
  if (tag === "wOF2") {
    return "woff2";
  }
  return null;
};

export const isobmffBrand = (bytes: Uint8Array): string | null => {
  if (!isIsobmff(bytes) || bytes.length < 12) {
    return null;
  }
  return ascii(bytes, 8, 4);
};
