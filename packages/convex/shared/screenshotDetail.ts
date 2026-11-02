/**
 * A page screenshot this light for its size is mostly blank: a JPEG of a
 * near-empty page compresses to almost nothing. Teak's renderer takes
 * 1280×720 screenshots at quality 80, where a blank page is about 6 KB, a
 * one-line page 9 KB, a small form 12 KB, a short text page ~24 KB and an
 * ordinary page 95–125 KB, so the line sits at 32 KB for that size.
 */
export const LOW_DETAIL_SCREENSHOT_BYTES_PER_PIXEL = (32 * 1024) / (1280 * 720);

export interface ScreenshotSize {
  screenshotBytes?: number;
  screenshotHeight?: number;
  screenshotWidth?: number;
}

/** True when the screenshot is known to show next to nothing. */
export function isLowDetailScreenshot(
  preview?: ScreenshotSize | null
): boolean {
  const bytes = preview?.screenshotBytes;
  const width = preview?.screenshotWidth;
  const height = preview?.screenshotHeight;
  if (
    !(
      typeof bytes === "number" &&
      typeof width === "number" &&
      typeof height === "number"
    ) ||
    bytes <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }
  return bytes / (width * height) < LOW_DETAIL_SCREENSHOT_BYTES_PER_PIXEL;
}
