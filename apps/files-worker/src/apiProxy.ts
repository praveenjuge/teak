/**
 * Edge proxy for the public API and MCP server on the marketing host.
 *
 * `teakvault.com/api`, `/mcp` and the OAuth discovery documents used to reach
 * Convex through rewrites on the docs site's Vercel project
 * (`apps/docs/vercel.json`). Zone routes in `wrangler.jsonc` now send those
 * paths here first, and this module forwards them to the same Convex HTTP
 * paths, so clients keep their URLs while Vercel leaves the request path.
 * Requests on any other host, or paths the routes catch by prefix but Convex
 * does not serve (`/apis`), are left to the caller.
 */

import { PUBLIC_API_CORS_HEADERS } from "@teak/convex/shared/publicApiHeaders";
import { EDGE_RATE_LIMIT_HEADER } from "@teak/files-protocol";
import type { EdgeRateLimitOutcome } from "./edgeRateLimit";

export interface ApiProxyEnv {
  /** Host whose API paths this Worker proxies (`teakvault.com`). Unset disables the proxy. */
  API_PUBLIC_HOST?: string;
  /** Convex HTTP origin the paths are forwarded to (`https://<name>.convex.site`). */
  API_UPSTREAM_ORIGIN?: string;
}

/** Convex HTTP actions refuse request bodies over 20 MiB; refuse them here first. */
export const API_PROXY_MAX_BODY_BYTES = 20 * 1024 * 1024;

/** How long the edge keeps public discovery documents before asking Convex again. */
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

/** Same headers the docs site's Vercel config added to these responses. */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/** Restores the upstream Cache-Control on a response served from the edge cache. */
const CLIENT_CACHE_CONTROL_HEADER = "X-Teak-Client-Cache-Control";

/**
 * Headers set by Cloudflare or a previous proxy, and the edge rate-limit
 * attestation, which only this Worker may set: the upstream request gets
 * fresh ones.
 */
const isHopHeader = (name: string): boolean =>
  name === "host" ||
  name === "x-real-ip" ||
  name === EDGE_RATE_LIMIT_HEADER ||
  name.startsWith("cf-") ||
  name.startsWith("x-forwarded-");

/**
 * The Convex HTTP path for a public path, or null when Convex does not serve
 * it. Mirrors the docs site's former rewrites: `/api` is the v1 discovery
 * document, `/api/<path>` drops the prefix, and MCP and the discovery
 * documents keep their paths.
 */
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

/** An error the Worker answers itself, with the headers Convex's API errors carry. */
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
    if (!isHopHeader(name.toLowerCase())) {
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

/**
 * Proxies an API, MCP or OAuth discovery request to Convex. Returns null when
 * the request is not one this Worker proxies, so the caller handles it.
 */
export const handleApiProxyRequest = async (
  request: Request,
  env: ApiProxyEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  options: {
    cache?: Cache | null;
    fetcher?: typeof fetch;
    /** Charges the request to its edge rate limit before it is answered. */
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
  }

  const fetcher = options.fetcher ?? fetch;
  const cache = options.cache ?? null;
  const cacheable = cache !== null && isEdgeCacheable(request, url);
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cacheable) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      // Each response carries its own request ID for support; a cached copy
      // must not repeat the one Convex gave the request that filled it.
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
