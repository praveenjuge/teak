export const RENDERER_PROTOCOL = 1;
export const RENDERER_PORT = 8080;
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

export const RENDERER_ERROR_STATUS = {
  bad_request: 400,
  busy: 503,
  internal: 500,
  not_found: 404,
  timeout: 422,
  too_large: 413,
  unsupported: 415,
} as const;

export type RendererErrorCode = keyof typeof RENDERER_ERROR_STATUS;
