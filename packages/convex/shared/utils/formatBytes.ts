const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * A file size for people to read, in binary (1024) steps: `512 B`, `4.6 MB`,
 * `50 MB`. Sizes under 10 of a unit keep one decimal; larger ones and whole
 * bytes are rounded. Zero, negative, missing and non-finite sizes read `0 B`.
 */
export const formatBytes = (bytes?: number | null): string => {
  if (!(bytes && Number.isFinite(bytes) && bytes > 0)) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
};
