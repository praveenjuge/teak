/**
 * Rendering and media operations. Browser Run renders HTML; the media renderer
 * Container (ffmpeg and poppler) handles video, audio and PDF sources. A
 * missing, busy or failing renderer answers RENDERER_UNAVAILABLE, which Convex
 * retries. UNSUPPORTED and PAYLOAD_TOO_LARGE mean the source itself cannot be
 * rendered, so Convex records the stage as failed without retrying.
 */

/** Largest source the media renderer reads; Teak uploads are capped at this. */
export const FILES_RENDER_MAX_SOURCE_BYTES = 100 * 1024 * 1024;

/** Audio waveform bar counts: grid cards and the detail player. */
export const FILES_WAVEFORM_BARS = { detail: 200, grid: 45 } as const;

/** Frames in a video's hover scrub sprite. */
export const FILES_SCRUB_FRAMES = 10;

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

/**
 * `scrubDestinationKey` is optional and additive: when set, the Worker also
 * stores a horizontal JPEG sprite of FILES_SCRUB_FRAMES evenly spaced frames.
 */
export interface FilesVideoFrameParams extends FilesRenderThumbnailParams {
  scrubDestinationKey?: string;
}

/** A sprite `frames * frameWidth` wide and `frameHeight` tall. */
export interface FilesVideoScrub {
  frameHeight: number;
  frames: number;
  frameWidth: number;
}

export interface FilesVideoFrameResult {
  durationSeconds: number | null;
  /** Container facts from the same pass, so Convex needs no probe-media. */
  facts?: FilesMediaProbeResult;
  originalHeight: number | null;
  originalWidth: number | null;
  /**
   * Main colors (`#RRGGBB`, largest share first) across the thumbnail and the
   * scrub frames. Absent from a renderer that predates it.
   */
  palette?: string[];
  /** Present when a sprite was requested and stored; best effort. */
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

/** Main colors (`#RRGGBB`, largest share first) across an animation's frames. */
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
  /** Run Whisper on the audio (converted when its codec is not mp3 or PCM). */
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
