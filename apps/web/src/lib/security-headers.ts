export const CSP_NONCE_HEADER = "x-nonce";

const TEAK_R2_STORAGE_ORIGIN =
  "https://teak-files-prod.dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";

export const buildContentSecurityPolicy = (nonce: string) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [
      "img-src 'self' blob: data:",
      TEAK_R2_STORAGE_ORIGIN,
      "https://www.google.com",
      "https://*.teakvault.com",
    ].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' blob:`,
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
    ].join(" "),
    ["media-src 'self' blob: data:", TEAK_R2_STORAGE_ORIGIN].join(" "),
    "frame-src https://*.polar.sh https://polar.sh",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");

export const staticSecurityHeaders: { key: string; value: string }[] = [
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
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

export const securityHeaders = (nonce: string) => [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(nonce),
  },
  ...staticSecurityHeaders,
];
