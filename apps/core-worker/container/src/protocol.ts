export const RENDERER_PROTOCOL = 1;
export const RENDERER_PORT = 8080;
/**
 * Must equal FILES_UPLOAD_MAX_BYTES (checked in rendererClient.test.ts): the
 * image builds from container/ alone, so it can't import it.
 */
export const RENDERER_MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_UTF8_BYTES_PER_CHAR = 4;

export const RENDERER_JOBS = {
  animationPalette: { path: "/animation/palette", wallClockMs: 30_000 },
  audio: { path: "/audio", wallClockMs: 120_000 },
  pdfPage: { path: "/pdf/page", wallClockMs: 30_000 },
  pdfText: { path: "/pdf/text", wallClockMs: 30_000 },
  probe: { path: "/probe", wallClockMs: 15_000 },
  video: { path: "/video", wallClockMs: 60_000 },
} as const;

export type RendererJob = keyof typeof RENDERER_JOBS;

/**
 * An instance that can't take the request now answers this, and the Worker
 * tries the next one. The fetcher answers FETCHER_BUSY_STATUS, which must equal
 * it (checked in containerPool.test.ts): its image builds without container/.
 */
export const CONTAINER_BUSY_STATUS = 503;

export const RENDERER_ERROR_STATUS = {
  bad_request: 400,
  busy: CONTAINER_BUSY_STATUS,
  internal: 500,
  not_found: 404,
  timeout: 422,
  too_large: 413,
  unsupported: 415,
} as const;

export type RendererErrorCode = keyof typeof RENDERER_ERROR_STATUS;
