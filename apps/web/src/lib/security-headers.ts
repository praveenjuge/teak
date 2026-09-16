const TEAK_R2_STORAGE_ORIGIN =
  "https://teak-files-prod.dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const TEAK_R2_UPLOAD_ORIGIN =
  "https://dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
// Worker-gated private file origin (see apps/files-worker). URLs minted by the
// Convex backend carry short-lived HMAC tokens; the worker streams from R2.
const TEAK_FILES_ORIGIN = "https://files.teakvault.com";
const R2_FRAME_SOURCES = [
  "https://*.r2.cloudflarestorage.com",
  "https://*.r2.dev",
] as const;

const normalizeHttpsOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/**
 * Self-hosted file origins. Mirror the backend FILES_BASE into
 * NEXT_PUBLIC_FILES_BASE at web build time so signed file URLs stay
 * loadable; static Teak origins always apply.
 */
const customFilesOrigins = (): string[] => {
  const values = [process.env.NEXT_PUBLIC_FILES_BASE];
  return Array.from(
    new Set(
      values.flatMap((value) => {
        if (!value) {
          return [];
        }
        const origin = normalizeHttpsOrigin(value.trim());
        return origin ? [origin] : [];
      })
    )
  );
};

export const buildContentSecurityPolicy = (
  environment: "development" | "production" | "test" | undefined = process.env
    .NODE_ENV
) => {
  const customOrigins = customFilesOrigins();
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [
      "img-src 'self' blob: data:",
      TEAK_R2_STORAGE_ORIGIN,
      "https://www.google.com",
      "https://*.gstatic.com",
      "https://*.teakvault.com",
      ...customOrigins,
    ].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    [
      "script-src 'self'",
      "blob:",
      "https://va.vercel-scripts.com",
      // Next.js emits inline bootstrap scripts in both production and
      // development. SHA-384 SRI still covers external framework chunks, while
      // eval remains limited to development tooling.
      "'unsafe-inline'",
      ...(environment === "development" ? ["'unsafe-eval'"] : []),
    ].join(" "),
    [
      "connect-src 'self'",
      "https://*.convex.cloud",
      "wss://*.convex.cloud",
      "https://*.convex.site",
      "https://*.ingest.us.sentry.io",
      "https://vitals.vercel-insights.com",
      "https://polar.sh",
      "https://*.polar.sh",
      TEAK_R2_STORAGE_ORIGIN,
      TEAK_FILES_ORIGIN,
      TEAK_R2_UPLOAD_ORIGIN,
      ...customOrigins,
    ].join(" "),
    [
      "media-src 'self' blob: data:",
      TEAK_R2_STORAGE_ORIGIN,
      TEAK_FILES_ORIGIN,
      ...customOrigins,
    ].join(" "),
    [
      "frame-src https://*.polar.sh https://polar.sh",
      TEAK_R2_STORAGE_ORIGIN,
      TEAK_FILES_ORIGIN,
      ...R2_FRAME_SOURCES,
      ...customOrigins,
    ].join(" "),
    "worker-src 'self' blob:",
    // Production is https-only, but development serves plain http://localhost
    // where this directive breaks every subresource with TLS failures.
    // Fail closed: only explicit development/test omit the directive.
    ...(environment === "development" || environment === "test"
      ? []
      : ["upgrade-insecure-requests"]),
  ].join("; ");
};

export const staticSecurityHeaders: { key: string; value: string }[] = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(),
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self)",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];
