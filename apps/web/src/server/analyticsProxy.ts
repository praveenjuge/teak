import { resolveAnalyticsProxyTarget } from "@/lib/posthog-config";

/**
 * Same-origin PostHog proxy at /ingest. It never sits behind sign-in, and it
 * drops the browser's cookies: Teak's session must not reach a third party,
 * and the large WorkOS cookie overflows the asset bucket's 8 KB header limit.
 * Returns null for any other path.
 */
export async function proxyAnalytics(
  request: Request
): Promise<Response | null> {
  const target = resolveAnalyticsProxyTarget(new URL(request.url));
  if (!target) {
    return null;
  }
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });
}
