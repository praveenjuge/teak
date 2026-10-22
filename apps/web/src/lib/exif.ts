export interface ImageExif {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  /**
   * Epoch ms, kept for released apps: an instant when the EXIF has an offset,
   * else the camera's clock time read as UTC. Shown only without takenAtClock.
   */
  takenAt?: number;
  /** The camera's clock time as epoch ms, read as if that clock were UTC. */
  takenAtClock?: number;
  /** Minutes east of UTC the camera recorded, when the EXIF has an offset. */
  takenAtOffset?: number;
}

export interface ExifField {
  label: string;
  value: string;
}

const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";

const trimDecimal = (value: number): string =>
  String(Math.round(value * 10) / 10);

export function formatCamera(make?: string, model?: string): string | null {
  const cleanMake = cleanText(make);
  const cleanModel = cleanText(model);
  if (!cleanModel) {
    return cleanMake || null;
  }
  if (
    !cleanMake ||
    cleanModel.toLowerCase().startsWith(cleanMake.toLowerCase().split(" ")[0])
  ) {
    return cleanModel;
  }
  return `${cleanMake} ${cleanModel}`;
}

// Cameras write exposures of 0.3 s and longer as decimals (0.4 s, 0.8 s);
// as fractions they would round to the wrong speed (0.8 s is not 1/1 s).
const DECIMAL_EXPOSURE_FROM_SECONDS = 0.3;

export function formatExposureTime(seconds?: number): string | null {
  if (!isPositive(seconds)) {
    return null;
  }
  if (seconds >= DECIMAL_EXPOSURE_FROM_SECONDS) {
    return `${trimDecimal(seconds)} s`;
  }
  return `1/${Math.round(1 / seconds)} s`;
}

const MAX_OFFSET_MINUTES = 14 * 60;

/** "UTC+5:30", "UTC-8" or "UTC", or null without a believable offset. */
const formatUtcOffset = (minutes?: number): string | null => {
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    Math.abs(minutes) > MAX_OFFSET_MINUTES
  ) {
    return null;
  }
  if (minutes === 0) {
    return "UTC";
  }
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${minutes < 0 ? "-" : "+"}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
};

const TAKEN_AT_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
};

const formatDate = (
  epochMs: unknown,
  options: Intl.DateTimeFormatOptions
): string | null => {
  if (!isPositive(epochMs)) {
    return null;
  }
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-US", options);
};

const formatTakenAt = (exif: ImageExif): string | null => {
  // takenAtClock is the camera's clock time encoded as UTC, so it's formatted
  // in UTC: a photo taken at 09:00 reads 09:00 wherever it's viewed.
  const clock = formatDate(exif.takenAtClock, {
    ...TAKEN_AT_FORMAT,
    timeZone: "UTC",
  });
  if (clock) {
    const zone = formatUtcOffset(exif.takenAtOffset);
    return zone ? `${clock} ${zone}` : clock;
  }
  // Photos processed before takenAtClock existed keep their old reading.
  return formatDate(exif.takenAt, TAKEN_AT_FORMAT);
};

export function formatExifFields(exif?: ImageExif | null): ExifField[] {
  if (!exif) {
    return [];
  }
  const fields: [string, string | null][] = [
    ["Camera", formatCamera(exif.make, exif.model)],
    ["Taken", formatTakenAt(exif)],
    ["Exposure", formatExposureTime(exif.exposureTime)],
    [
      "Aperture",
      isPositive(exif.fNumber) ? `f/${trimDecimal(exif.fNumber)}` : null,
    ],
    [
      "Focal length",
      isPositive(exif.focalLength)
        ? `${trimDecimal(exif.focalLength)} mm`
        : null,
    ],
    ["ISO", isPositive(exif.iso) ? String(Math.round(exif.iso)) : null],
  ];
  return fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([label, value]) => ({ label, value }));
}
