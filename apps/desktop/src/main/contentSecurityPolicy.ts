// Renderer CSP for packaged builds (the Vite dev server needs inline scripts
// for HMR, so it gets none).

const TEAK_FILES_ORIGIN = "https://files.teakvault.com";
// The dev deployment's isolated Files Worker (scripts/check-cloudflare.ts
// DEVELOPMENT_FILES_ORIGIN). Only builds for that exact deployment
// (packages/convex/auth.config.ts) allow it; production builds never do.
const TEAK_DEV_CONVEX_ORIGIN = "https://reminiscent-kangaroo-59.convex.cloud";
export const TEAK_DEV_FILES_ORIGIN =
  "https://teak-files-development.praveenjuge.workers.dev";

const filesOrigins = (convexUrl: string | undefined): string[] => {
  try {
    return convexUrl && new URL(convexUrl).origin === TEAK_DEV_CONVEX_ORIGIN
      ? [TEAK_FILES_ORIGIN, TEAK_DEV_FILES_ORIGIN]
      : [TEAK_FILES_ORIGIN];
  } catch {
    return [TEAK_FILES_ORIGIN];
  }
};

export const buildRendererContentSecurityPolicy = (
  convexUrl: string | undefined
): string => {
  const files = filesOrigins(convexUrl).join(" ");
  return [
    "default-src 'self'",
    // `https://*.r2.cloudflarestorage.com` is required for the direct
    // file-upload PUT against R2. The Files Worker serves signed downloads.
    `connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://app.teakvault.com https://teakvault.com ${files} https://*.r2.cloudflarestorage.com`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    // `frame-src` covers the PDF preview iframe, which points at a signed
    // cross-origin URL.
    `frame-src 'self' blob: ${files} https://*.r2.cloudflarestorage.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");
};
