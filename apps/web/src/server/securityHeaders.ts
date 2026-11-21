import { staticSecurityHeaders } from "@/lib/security-headers";

/**
 * Every response the Worker renders carries Teak's security headers and CSP.
 * Pages and server-function answers are never cached anywhere: they hold the
 * person's library and their access token. A route that sets its own cache
 * rule (the manifest, the service worker) keeps it. Static files get their
 * headers from public/_headers.
 */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const { key, value } of staticSecurityHeaders) {
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
