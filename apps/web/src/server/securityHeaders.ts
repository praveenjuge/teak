import {
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "@/lib/security-headers";

/** A fresh CSP nonce for one request: 128 random bits, base64. */
export function createNonce(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))
  );
}

/**
 * Every response the Worker renders carries Teak's security headers and a
 * CSP that runs inline scripts only when they carry this request's `nonce`.
 * Pages and server-function answers are never cached anywhere: they hold the
 * person's library and their access token. A route that sets its own cache
 * rule (the manifest, the service worker) keeps it. Static files get their
 * headers from public/_headers.
 */
export function withSecurityHeaders(
  response: Response,
  nonce?: string
): Response {
  const secured = new Response(response.body, response);
  const headers = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(process.env.NODE_ENV, nonce),
    },
    ...staticSecurityHeaders,
  ];
  for (const { key, value } of headers) {
    if (!secured.headers.has(key)) {
      secured.headers.set(key, value);
    }
  }
  if (
    secured.headers.get("Content-Type")?.startsWith("text/html") ||
    !secured.headers.has("Cache-Control")
  ) {
    secured.headers.set("Cache-Control", "private, no-store");
  }
  return secured;
}
