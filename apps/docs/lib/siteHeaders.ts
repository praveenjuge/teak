// Sent with every response from teakvault.com. Blume has no option for custom
// headers, so the build adds this rule to the `_headers` file it writes for
// Cloudflare, which only covers static assets. worker.ts adds the same headers
// to the Markdown responses it generates. CORS stays open, as it was on Vercel,
// so browser agents and other sites can read the Markdown, llms.txt and OpenAPI
// files.
export const SITE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;
