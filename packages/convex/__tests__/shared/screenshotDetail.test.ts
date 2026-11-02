import { describe, expect, test } from "bun:test";
import { isLowDetailScreenshot } from "../../shared/screenshotDetail";

const shot = (kilobytes: number) => ({
  screenshotBytes: kilobytes * 1024,
  screenshotHeight: 720,
  screenshotWidth: 1280,
});

describe("isLowDetailScreenshot", () => {
  test("calls a near-blank page low detail", () => {
    // Blank, one-line, small form and short text pages, measured at
    // 1280×720 quality-80 JPEG.
    for (const kilobytes of [6, 9, 12, 24]) {
      expect(isLowDetailScreenshot(shot(kilobytes))).toBe(true);
    }
  });

  test("keeps an ordinary page's screenshot", () => {
    for (const kilobytes of [57, 96, 115, 124]) {
      expect(isLowDetailScreenshot(shot(kilobytes))).toBe(false);
    }
  });

  test("scales with the screenshot's size", () => {
    expect(
      isLowDetailScreenshot({
        screenshotBytes: 24 * 1024 * 4,
        screenshotHeight: 1440,
        screenshotWidth: 2560,
      })
    ).toBe(true);
  });

  test("says nothing about a screenshot it can't measure", () => {
    expect(isLowDetailScreenshot(undefined)).toBe(false);
    expect(isLowDetailScreenshot({ screenshotBytes: 1000 })).toBe(false);
    expect(isLowDetailScreenshot({ ...shot(6), screenshotWidth: 0 })).toBe(
      false
    );
  });
});
