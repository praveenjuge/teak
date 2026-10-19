export interface ImageExif {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  takenAt?: number;
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

const formatTakenAt = (takenAt?: number): string | null => {
  if (!isPositive(takenAt)) {
    return null;
  }
  const date = new Date(takenAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export function formatExifFields(exif?: ImageExif | null): ExifField[] {
  if (!exif) {
    return [];
  }
  const fields: [string, string | null][] = [
    ["Camera", formatCamera(exif.make, exif.model)],
    ["Taken", formatTakenAt(exif.takenAt)],
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
