/**
 * Rendering and media operations. A Worker without the Browser Run or Media
 * binding, or a source outside an operation's limits, answers UNSUPPORTED or
 * PAYLOAD_TOO_LARGE, which Convex treats as "keep the previous renderer".
 */

/** Full-viewport link screenshots are exactly this size. */
export const FILES_SCREENSHOT_SIZE = { height: 720, width: 1280 } as const;

/** Hides scrollbars, cookie banners and sticky chrome before a screenshot. */
export const SCREENSHOT_CLEANUP_CSS = `
  html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
  .cookie-banner, .cookie-consent, .privacy-popup, .newsletter-popup, .modal-overlay, .popup, .ad, .advertisement, .sponsored { display: none !important; visibility: hidden !important; }
  body { margin: 0 !important; padding: 0 !important; min-height: 100vh !important; }
  .floating, .sticky, .fixed { display: none !important; }
  [data-testid="BottomBar"], [data-testid="sheetDialog"], [data-testid="HoverCard"], [data-testid="app-bar-close"], [aria-label="Sign up"] { display: none !important; visibility: hidden !important; }
`;

export const FILES_SCRAPE_LIMITS = {
  elements: 100,
  selectorChars: 512,
  selectors: 128,
  valueChars: 100_000,
} as const;

/** Thumbnail ops write an image to `destinationKey` in the source's namespace. */
export interface FilesRenderThumbnailParams {
  destinationKey: string;
  sourceKey: string;
}

export interface FilesPdfThumbnailResult {
  height: number;
  storedBytes: number;
  storedContentType: "image/png";
  width: number;
}

export interface FilesVideoFrameResult {
  durationSeconds: number | null;
  originalHeight: number | null;
  originalWidth: number | null;
  storedBytes: number;
  storedContentType: "image/jpeg";
}

/** HTML is gzip-compressed and base64-encoded so 2 MiB pages fit in 1 MiB. */
export interface FilesCaptureScreenshotParams {
  destinationKey: string;
  htmlGzipBase64: string;
}

export interface FilesCaptureScreenshotResult {
  height: number;
  storedBytes: number;
  storedContentType: "image/jpeg";
  width: number;
}

export interface FilesScrapeParams {
  htmlGzipBase64: string;
  selectors: string[];
}

export interface FilesScrapeResult {
  selectors: Array<{
    results: Array<{
      attributes?: Array<{ name: string; value: string }>;
      html?: string;
      text?: string;
    }>;
    selector: string;
  }>;
}

export interface FilesMediaProbeResult {
  container: "mp4" | "mov" | "webm";
  durationSeconds: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  height: number | null;
  videoCodec: string | null;
  width: number | null;
}
