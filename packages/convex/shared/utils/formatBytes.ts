const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export const formatBytes = (bytes?: number | null, locale?: string): string => {
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
  const number = locale
    ? new Intl.NumberFormat(locale, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
        useGrouping: false,
      }).format(value)
    : value.toFixed(digits);
  return `${number} ${BYTE_UNITS[unit]}`;
};
