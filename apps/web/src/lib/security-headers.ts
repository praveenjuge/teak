export const CSP_NONCE_HEADER = "x-nonce";

const TEAK_R2_STORAGE_ORIGIN =
  "https://teak-files-prod.dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const TEAK_R2_UPLOAD_ORIGIN =
  "https://dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const R2_FRAME_SOURCES = [
  "https://*.r2.cloudflarestorage.com",
  "https://*.r2.dev",
] as const;

const normalizeHttpsOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const configuredR2StorageSources = () => {
  const values = [
    process.env.NEXT_PUBLIC_R2_STORAGE_ORIGIN,
    process.env.NEXT_PUBLIC_R2_STORAGE_URL,
    process.env.R2_STORAGE_ORIGIN,
    process.env.R2_STORAGE_URL,
  ];
  return Array.from(
    new Set(
      values.flatMap(
        (value) =>
          value
            ?.split(",")
            .map((item) => normalizeHttpsOrigin(item.trim()))
            .filter((item): item is string => Boolean(item)) ?? []
      )
    )
  );
};

const configuredR2FrameSources = () => {
  const values = [
    process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN,
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
    process.env.R2_PUBLIC_ORIGIN,
    process.env.R2_PUBLIC_URL,
  ];
  return Array.from(
    new Set(
      values.flatMap(
        (value) =>
          value
            ?.split(",")
            .map((item) => normalizeHttpsOrigin(item.trim()))
            .filter((item): item is string => Boolean(item)) ?? []
      )
    )
  );
};

const configuredR2UploadSources = () => {
  const values = [
    TEAK_R2_UPLOAD_ORIGIN,
    process.env.NEXT_PUBLIC_R2_UPLOAD_ORIGIN,
    process.env.NEXT_PUBLIC_R2_UPLOAD_URL,
    process.env.R2_UPLOAD_ORIGIN,
    process.env.R2_UPLOAD_URL,
    process.env.R2_ENDPOINT,
  ];
  return Array.from(
    new Set(
      values.flatMap(
        (value) =>
          value
            ?.split(",")
            .map((item) => normalizeHttpsOrigin(item.trim()))
            .filter((item): item is string => Boolean(item)) ?? []
      )
    )
  );
};

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
      ...configuredR2StorageSources(),
      "https://www.google.com",
      "https://*.gstatic.com",
      "https://*.teakvault.com",
    ].join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    [
      "script-src 'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "blob:",
      // Next.js/React development mode relies on eval() for Fast Refresh and
      // for reconstructing callstacks. Only permitted outside production.
      ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
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
      ...configuredR2StorageSources(),
      ...configuredR2UploadSources(),
    ].join(" "),
    [
      "media-src 'self' blob: data:",
      TEAK_R2_STORAGE_ORIGIN,
      ...configuredR2StorageSources(),
    ].join(" "),
    [
      "frame-src https://*.polar.sh https://polar.sh",
      TEAK_R2_STORAGE_ORIGIN,
      ...configuredR2StorageSources(),
      ...R2_FRAME_SOURCES,
      ...configuredR2FrameSources(),
    ].join(" "),
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");

export const staticSecurityHeaders: { key: string; value: string }[] = [
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

export const securityHeaders = (nonce: string) => [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(nonce),
  },
  ...staticSecurityHeaders,
];
