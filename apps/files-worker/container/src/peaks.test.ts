import { describe, expect, test } from "bun:test";
import { PeakWindows, peaksFromWindows, SAMPLES_PER_WINDOW } from "./peaks";

function pcm(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (const [index, sample] of samples.entries()) {
    view.setInt16(index * 2, sample, true);
  }
  return bytes;
}

describe("PeakWindows", () => {
  test("takes the loudest |sample| of each 50 ms window", () => {
    const samples = new Array<number>(SAMPLES_PER_WINDOW * 2 + 10).fill(0);
    samples[3] = -1200;
    samples[SAMPLES_PER_WINDOW + 7] = 900;
    samples[SAMPLES_PER_WINDOW * 2 + 1] = -32_768;
    const windows = new PeakWindows();
    windows.push(pcm(samples));
    expect(windows.finish()).toEqual([1200, 900, 32_768]);
  });

  test("gives the same windows however the stream is chunked, even mid-sample", () => {
    const samples = Array.from(
      { length: SAMPLES_PER_WINDOW * 3 },
      (_, index) => ((index * 7919) % 65_536) - 32_768
    );
    const bytes = pcm(samples);
    const whole = new PeakWindows();
    whole.push(bytes);
    const split = new PeakWindows();
    split.push(bytes.subarray(0, 0));
    let offset = 0;
    for (const size of [1, 3, 2, 999, 7, 1]) {
      split.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    split.push(bytes.subarray(offset));
    expect(split.finish()).toEqual(whole.finish());
  });

  test("an empty stream has no windows", () => {
    expect(new PeakWindows().finish()).toEqual([]);
  });
});

describe("peaksFromWindows", () => {
  test("takes the max per bucket, normalises, applies sqrt and rounds to 0–100", () => {
    expect(peaksFromWindows([100, 400, 100, 0, 1600, 900], 3)).toEqual([
      50, 25, 100,
    ]);
  });

  test("returns exactly the requested number of bars", () => {
    const windows = Array.from({ length: 1234 }, (_, index) => index % 97);
    for (const count of [1, 45, 200, 1000]) {
      const bars = peaksFromWindows(windows, count);
      expect(bars).toHaveLength(count);
      expect(Math.max(...bars)).toBe(100);
      expect(Math.min(...bars)).toBeGreaterThanOrEqual(0);
    }
  });

  test("stretches short audio across more bars than windows", () => {
    expect(peaksFromWindows([16, 4], 4)).toEqual([100, 100, 50, 50]);
  });

  test("silence and empty audio stay at zero", () => {
    expect(peaksFromWindows([0, 0, 0], 5)).toEqual([0, 0, 0, 0, 0]);
    expect(peaksFromWindows([], 3)).toEqual([0, 0, 0]);
  });
});
