import { httpAction } from "./_generated/server";
import {
  isLocalDevelopmentHostname,
  resolveTeakDevAppUrl,
} from "./devUrls";

export const API_VERSION = "v1";

export const V1_ENDPOINTS = [
  "GET /v1/cards",
  "POST /v1/cards",
  "POST /v1/uploads",
  "POST /v1/cards/bulk",
  "GET /v1/cards/changes",
  "GET /v1/cards/search",
  "GET /v1/cards/favorites",
  "GET /v1/cards/:cardId",
  "PATCH /v1/cards/:cardId",
  "DELETE /v1/cards/:cardId",
  "PATCH /v1/cards/:cardId/favorite",
  "GET /v1/tags",
] as const;

export const API_AUTH_HINT =
  "Authorization: Bearer <token> (OAuth access token or teakapi_ API key)";
export const MCP_TRANSPORT = "streamable-http";

export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key, X-Request-Id",
  "Access-Control-Expose-Headers":
    "X-Request-Id, Idempotency-Key, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  "Access-Control-Max-Age": "86400",
};

const PROD_PUBLIC_API_URL = "https://api.teakvault.com";
const PROD_AUTH_ISSUER_URL = "https://app.teakvault.com";
const OAUTH_SCOPES_SUPPORTED = ["profile", "email", "offline_access"];

const normalizeBaseUrl = (raw: string): string => raw.replace(/\/+$/, "");

const isLocalApiHost = (hostname: string): boolean =>
  isLocalDevelopmentHostname(hostname);

const isConvexSiteHost = (hostname: string): boolean =>
  hostname.endsWith(".convex.site");

export const getMcpEndpointFromRequestUrl = (requestUrl: string): string => {
  const incoming = new URL(requestUrl);
  return `${incoming.origin}/mcp`;
};

const getPublicApiUrl = (requestUrl: string): string => {
  const fromEnv = process.env.PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const { hostname, origin } = new URL(requestUrl);
  return isLocalApiHost(hostname) || isConvexSiteHost(hostname)
    ? origin
    : PROD_PUBLIC_API_URL;
};

const getAuthIssuerUrl = (requestUrl: string): string => {
  const fromEnv =
    process.env.AUTH_ISSUER_URL?.trim() || process.env.SITE_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const { hostname } = new URL(requestUrl);
  return isLocalApiHost(hostname)
    ? resolveTeakDevAppUrl(process.env)
    : PROD_AUTH_ISSUER_URL;
};

export const getProtectedResourceUrl = (requestUrl: string): string =>
  `${getPublicApiUrl(requestUrl)}/.well-known/oauth-protected-resource`;

export const buildProtectedResourceMetadata = (requestUrl: string) => ({
  resource: `${getPublicApiUrl(requestUrl)}/mcp`,
  authorization_servers: [getAuthIssuerUrl(requestUrl)],
  bearer_methods_supported: ["header"],
  scopes_supported: OAUTH_SCOPES_SUPPORTED,
  resource_name: "Teak",
});

export const json = (
  status: number,
  body: unknown,
  headers?: HeadersInit
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...(headers ?? {}),
    },
  });

export const withPublicApiGatewayHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) {
    headers.set(key, value);
  }
  if (!headers.has("X-Request-Id")) {
    headers.set("X-Request-Id", crypto.randomUUID());
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const v1CorsPreflightResponse = (): Response =>
  withPublicApiGatewayHeaders(new Response(null, { status: 204 }));

export const healthzV1 = httpAction(async () =>
  withPublicApiGatewayHeaders(
    json(200, {
      status: "ok",
      service: "teak-api",
      version: API_VERSION,
    })
  )
);

export const discoveryV1 = httpAction(async (_ctx, request) => {
  if (request.method === "OPTIONS") {
    return v1CorsPreflightResponse();
  }

  return withPublicApiGatewayHeaders(
    json(200, {
      version: API_VERSION,
      endpoints: V1_ENDPOINTS,
      auth: API_AUTH_HINT,
      mcp: {
        endpoint: getMcpEndpointFromRequestUrl(request.url),
        transport: MCP_TRANSPORT,
        auth: API_AUTH_HINT,
      },
    })
  );
});

export const v1CorsPreflight = httpAction(async () => v1CorsPreflightResponse());
