import { describe, expect, test } from "bun:test";
import { AUDIO_WAVE_BARS, getAudioWaveHeight } from "../../shared/audioWave";

describe("getAudioWaveHeight", () => {
  // The Apple and Android apps port this function and pin these same values
  // (LibraryTests.swift, CardGrid.kt), so a recording looks the same everywhere.
  test("draws the waveform the native apps mirror", () => {
    expect(AUDIO_WAVE_BARS).toBe(45);
    for (const [index, expected] of [
      [0, 36.131],
      [1, 67.497],
      [7, 42.315],
      [44, 55.251],
    ] as const) {
      expect(
        Number.parseFloat(getAudioWaveHeight("k17abc123", index))
      ).toBeCloseTo(expected, 2);
    }
  });

  test("keeps every bar between 20% and 80% tall", () => {
    for (let index = 0; index < AUDIO_WAVE_BARS; index++) {
      const height = Number.parseFloat(getAudioWaveHeight("seed", index));
      expect(height).toBeGreaterThanOrEqual(20);
      expect(height).toBeLessThanOrEqual(80);
    }
  });
});
