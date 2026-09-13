/**
 * Shared byte readers for the upload-verification container parsers.
 *
 * Every reader tolerates short input and never throws, so parsers can probe
 * truncated head windows safely.
 */

export interface MediaFacts {
  codec?: string;
  container?: string;
  duration?: number;
  fontFamily?: string;
  fontFormat?: string;
  height?: number;
  pageCount?: number;
  width?: number;
}

export const ascii = (
  bytes: Uint8Array,
  start: number,
  length: number
): string => {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[start + index] ?? 0);
  }
  return out;
};

export const startsWith = (
  bytes: Uint8Array,
  expected: readonly number[]
): boolean => expected.every((value, index) => bytes[index] === value);

export const u16be = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

export const u32be = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) * 0x1_00_00_00 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)) >>>
  0;

export const u32le = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset + 3] ?? 0) * 0x1_00_00_00 +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 1] ?? 0) << 8) +
    (bytes[offset] ?? 0)) >>>
  0;
