export const FILES_WAVEFORM_BARS = { detail: 200, grid: 45 } as const;

export const FILES_SCRUB_FRAMES = 10;

export const FILES_SCREENSHOT_SIZE = { height: 720, width: 1280 } as const;

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

export interface FilesVideoFrameParams extends FilesRenderThumbnailParams {
  scrubDestinationKey?: string;
}

export interface FilesVideoScrub {
  frameHeight: number;
  frames: number;
  frameWidth: number;
}

export interface FilesVideoFrameResult {
  durationSeconds: number | null;
  facts?: FilesMediaProbeResult;
  originalHeight: number | null;
  originalWidth: number | null;
  /**
   * Main colors (`#RRGGBB`, largest share first) across the thumbnail and the
   * scrub frames. Absent from a renderer that predates it.
   */
  palette?: string[];
  scrub?: FilesVideoScrub | null;
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

export interface FilesAnimationPaletteParams {
  sourceKey: string;
}

export interface FilesAnimationPaletteResult {
  palette: string[];
}

export interface FilesMediaProbeResult {
  audioCodec?: string | null;
  /** Container format, as ffprobe names it: mp4, mov, webm, matroska, mp3, ... */
  container: string;
  durationSeconds: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  /** Display size, after rotation. */
  height: number | null;
  videoCodec: string | null;
  width: number | null;
}

export interface FilesProcessAudioParams {
  mimeType?: string;
  sourceKey: string;
  transcribe: boolean;
}

/** Bar heights from 0 to 100; lengths match FILES_WAVEFORM_BARS. */
export interface FilesAudioWaveform {
  detail: number[];
  grid: number[];
}

export type FilesAudioTranscript =
  | { status: "completed"; text: string }
  | { reason: string; status: "failed" | "skipped" };

export interface FilesProcessAudioResult {
  facts: FilesMediaProbeResult;
  peaks?: FilesAudioWaveform;
  transcript: FilesAudioTranscript;
}
