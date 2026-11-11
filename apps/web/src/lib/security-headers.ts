import {
  configuredOrigin,
  filesOrigins,
  type PublicEnvironment,
  readConvexUrl,
} from "./public-env";

const TEAK_R2_STORAGE_ORIGIN =
  "https://teak-files-prod.dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const TEAK_R2_UPLOAD_ORIGIN =
  "https://dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const R2_FRAME_SOURCES = [
  "https://*.r2.cloudflarestorage.com",
  "https://*.r2.dev",
] as const;

export const buildContentSecurityPolicy = (
  environment: PublicEnvironment | undefined = process.env.NODE_ENV
) => {
  const convexOrigin = configuredOrigin(readConvexUrl(), environment);
  const filesHosts = filesOrigins(environment);
  const convexOrigins = convexOrigin
    ? [convexOrigin, convexOrigin.replace(/^http/, "ws")]
    : [];
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
      ...filesHosts,
    ].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    [
      "script-src 'self'",
      "blob:",
      // Next.js emits inline bootstrap scripts in both production and
      // development. SHA-384 SRI still covers external framework chunks, while
      // eval remains limited to development tooling.
      "'unsafe-inline'",
      ...(environment === "development" ? ["'unsafe-eval'"] : []),
    ].join(" "),
    [
      "connect-src 'self'",
      ...convexOrigins,
      "https://*.convex.cloud",
      "wss://*.convex.cloud",
      "https://*.convex.site",
      "https://polar.sh",
      "https://*.polar.sh",
      TEAK_R2_STORAGE_ORIGIN,
      TEAK_R2_UPLOAD_ORIGIN,
      ...filesHosts,
    ].join(" "),
    [
      "media-src 'self' blob: data:",
      TEAK_R2_STORAGE_ORIGIN,
      ...filesHosts,
    ].join(" "),
    [
      "frame-src",
      TEAK_R2_STORAGE_ORIGIN,
      ...R2_FRAME_SOURCES,
      ...filesHosts,
    ].join(" "),
    // PostHog's session replay compresses recordings in a blob worker.
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
    // No `tools=(self)` for WebMCP: the feature's default allowlist is
    // already self, so Teak's pages register their tools and cross-origin
    // frames can't. Chromium without the WebMCP origin trial logs an error
    // on every page for a directive it doesn't know.
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
