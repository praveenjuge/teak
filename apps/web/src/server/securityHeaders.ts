import { staticSecurityHeaders } from "@/lib/security-headers";

/**
 * Every response the Worker renders carries Teak's security headers and CSP.
 * Pages are never cached anywhere: they hold the person's library and their
 * access token. Static files get their headers from public/_headers.
 */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const { key, value } of staticSecurityHeaders) {
    if (!secured.headers.has(key)) {
      secured.headers.set(key, value);
    }
  }
  if (secured.headers.get("Content-Type")?.startsWith("text/html")) {
    secured.headers.set("Cache-Control", "private, no-store");
  }
  return secured;
}
