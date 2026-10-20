import { PUBLIC_API_CORS_HEADERS } from "@teak/convex/shared/publicApiHeaders";
import { EDGE_RATE_LIMIT_HEADER } from "@teak/files-protocol";
import type { EdgeRateLimitOutcome } from "./edgeRateLimit";
import { answerMcpAtEdge } from "./mcpEdge";

export interface ApiProxyEnv {
  API_PUBLIC_HOST?: string;
  API_UPSTREAM_ORIGIN?: string;
}

/**
 * Convex documents a 20 MB limit on HTTP action requests; refuse larger
 * bodies here first. Measured against a deployment, Convex accepts bodies up
 * to about 20,480,000 bytes and answers a bare 502 past that, so 20 MiB
 * (20,971,520) let some oversized bodies through to that 502.
 */
export const API_PROXY_MAX_BODY_BYTES = 20_000_000;

export const API_PROXY_DOCUMENT_TTL_SECONDS = 300;

const WELL_KNOWN_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/teak-oauth-clients.json",
]);

/**
 * Public, identical-for-everyone documents. Convex marks them `no-store`, so
 * clients still revalidate every time, but the edge answers for a few minutes.
 */
const EDGE_CACHED_PATHS = new Set([...WELL_KNOWN_PATHS, "/api/openapi.json"]);

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const CLIENT_CACHE_CONTROL_HEADER = "X-Teak-Client-Cache-Control";

const isEdgeOwnedHeader = (name: string): boolean =>
  name === "host" ||
  name === "x-real-ip" ||
  name === EDGE_RATE_LIMIT_HEADER ||
  name.startsWith("cf-") ||
  name.startsWith("x-forwarded-");

export const upstreamPathFor = (pathname: string): string | null => {
  if (pathname === "/api") {
    return "/v1";
  }
  if (pathname.startsWith("/api/")) {
    return pathname.slice("/api".length);
  }
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return pathname;
  }
  if (WELL_KNOWN_PATHS.has(pathname)) {
    return pathname;
  }
  return null;
};

const errorResponse = (status: number, code: string, error: string) =>
  withSecurityHeaders(
    new Response(JSON.stringify({ code, error }), {
      status,
      headers: {
        ...PUBLIC_API_CORS_HEADERS,
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Request-Id": crypto.randomUUID(),
      },
    })
  );

const withSecurityHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  const clientCacheControl = headers.get(CLIENT_CACHE_CONTROL_HEADER);
  if (clientCacheControl !== null) {
    headers.delete(CLIENT_CACHE_CONTROL_HEADER);
    if (clientCacheControl) {
      headers.set("Cache-Control", clientCacheControl);
    } else {
      headers.delete("Cache-Control");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const upstreamHeaders = (
  request: Request,
  publicHost: string,
  attestation: string | null
): Headers => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!isEdgeOwnedHeader(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
    headers.set("X-Real-IP", clientIp);
  }
  headers.set("X-Forwarded-Host", publicHost);
  headers.set("X-Forwarded-Proto", "https");
  if (attestation) {
    headers.set(EDGE_RATE_LIMIT_HEADER, attestation);
  }
  return headers;
};

const declaredBodyTooLarge = (request: Request): boolean => {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > API_PROXY_MAX_BODY_BYTES;
};

const isEdgeCacheable = (request: Request, url: URL): boolean =>
  request.method === "GET" &&
  EDGE_CACHED_PATHS.has(url.pathname) &&
  !request.headers.has("authorization");

const cacheableCopy = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set(
    CLIENT_CACHE_CONTROL_HEADER,
    response.headers.get("Cache-Control") ?? ""
  );
  headers.set(
    "Cache-Control",
    `public, max-age=${API_PROXY_DOCUMENT_TTL_SECONDS}`
  );
  return new Response(response.body, { status: response.status, headers });
};

export const handleApiProxyRequest = async (
  request: Request,
  env: ApiProxyEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  options: {
    cache?: Cache | null;
    fetcher?: typeof fetch;
    rateLimit?: (request: Request) => Promise<EdgeRateLimitOutcome>;
  } = {}
): Promise<Response | null> => {
  const publicHost = env.API_PUBLIC_HOST;
  const upstreamOrigin = env.API_UPSTREAM_ORIGIN;
  if (!(publicHost && upstreamOrigin)) {
    return null;
  }
  const url = new URL(request.url);
  if (url.hostname !== publicHost) {
    return null;
  }
  const upstreamPath = upstreamPathFor(url.pathname);
  if (upstreamPath === null) {
    return null;
  }

  if (declaredBodyTooLarge(request)) {
    return errorResponse(413, "CONTENT_TOO_LARGE", "Request body is too large");
  }

  let attestation: string | null = null;
  if (options.rateLimit) {
    const outcome = await options.rateLimit(request);
    if ("response" in outcome) {
      return withSecurityHeaders(outcome.response);
    }
    attestation = outcome.attestation;
    if (upstreamPath === "/mcp") {
      const answered = await answerMcpAtEdge(request, outcome.identity);
      if (answered) {
        return withSecurityHeaders(answered);
      }
    }
  }

  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache ?? null;
  const cacheable = cache !== null && isEdgeCacheable(request, url);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cacheable) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = withSecurityHeaders(cached);
      hit.headers.set("X-Request-Id", crypto.randomUUID());
      return hit;
    }
  }

  // Append the path to the origin rather than resolving it against the
  // origin: resolved, a path like "//evil.example/x" (from "/api//evil...")
  // is protocol-relative and would point the proxy at another host.
  const pinnedOrigin = new URL(upstreamOrigin).origin;
  const upstreamUrl = new URL(`${pinnedOrigin}${upstreamPath}`);
  if (upstreamUrl.origin !== pinnedOrigin) {
    return errorResponse(404, "NOT_FOUND", "Not found");
  }
  upstreamUrl.search = url.search;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders(request, publicHost, attestation),
      body: hasBody ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
    return errorResponse(
      502,
      "SERVICE_UNAVAILABLE",
      "The service is unreachable. Retry the request."
    );
  }

  if (cacheable && upstream.status === 200) {
    const [forClient, forCache] = upstream.body
      ? upstream.body.tee()
      : [null, null];
    ctx.waitUntil(
      cache.put(cacheKey, cacheableCopy(new Response(forCache, upstream)))
    );
    return withSecurityHeaders(new Response(forClient, upstream));
  }

  return withSecurityHeaders(upstream);
};
