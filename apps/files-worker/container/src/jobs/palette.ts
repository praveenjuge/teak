import type { SampleSize } from "../args";
import { extractPalette } from "../palette";

/** The whole frames in `stdout`, or null when there are none. */
export function sampleFrames(
  stdout: Uint8Array,
  size: SampleSize
): Uint8Array | null {
  const frameBytes = size.width * size.height * 4;
  const whole = Math.floor(stdout.byteLength / frameBytes) * frameBytes;
  return whole > 0 ? stdout.subarray(0, whole) : null;
}

/** Hex colors, largest share first, across every sampled frame. */
export function paletteFromSamples(samples: Uint8Array[]): string[] {
  if (samples.length === 0) {
    return [];
  }
  return extractPalette(Buffer.concat(samples)).map((swatch) => swatch.hex);
}

/** The frame rate that spreads `frames` across the animation, or null for the first frame only. */
export function animationFrameRate(
  durationSeconds: number | null,
  frames: number
): number | null {
  if (durationSeconds === null || frames < 2) {
    return null;
  }
  return frames / durationSeconds;
}
