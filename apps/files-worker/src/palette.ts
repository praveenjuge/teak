import { PhotonImage } from "@cf-wasm/photon";

const MAX_COLORS = 5;
const SAMPLE_TARGET = 4000;
const CHANNEL_PRECISION = 16;

const quantizeChannel = (value: number): number => {
  const clamped = Math.max(0, Math.min(255, value));
  const bucket = Math.round(clamped / CHANNEL_PRECISION) * CHANNEL_PRECISION;
  return Math.max(0, Math.min(255, bucket));
};

const toHex = (value: number): string => value.toString(16).padStart(2, "0");
const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();

export const computePalette = (
  pixels: Uint8Array,
  maxColors = MAX_COLORS
): string[] => {
  const pixelCount = Math.floor(pixels.length / 4);
  if (!pixelCount) {
    return [];
  }
  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_TARGET));
  const colorCounts = new Map<string, number>();

  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    if ((pixels[offset + 3] ?? 0) < 16) {
      continue;
    }
    const hex = rgbToHex(
      quantizeChannel(pixels[offset] ?? 0),
      quantizeChannel(pixels[offset + 1] ?? 0),
      quantizeChannel(pixels[offset + 2] ?? 0)
    );
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  if (!colorCounts.size) {
    const [red = 0, green = 0, blue = 0] = pixels;
    return [rgbToHex(red, green, blue)];
  }
  return [...colorCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
};

export const paletteFromPng = (bytes: Uint8Array): string[] => {
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return computePalette(image.get_raw_pixels());
  } finally {
    image.free();
  }
};
