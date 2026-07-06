import { httpAction } from "./_generated/server";
import {
  isLocalDevelopmentHostname,
  resolveTeakDevApiUrl,
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

const PROD_PUBLIC_API_URL = "https://teakvault.com/api";
const PROD_PUBLIC_MCP_URL = "https://teakvault.com/mcp";
const PROD_AUTH_ISSUER_URL = "https://app.teakvault.com";
const OAUTH_SCOPES_SUPPORTED = ["profile", "email", "offline_access"];

const normalizeBaseUrl = (raw: string): string => raw.replace(/\/+$/, "");

const isLocalApiHost = (hostname: string): boolean =>
  isLocalDevelopmentHostname(hostname);

export const getPublicApiUrl = (requestUrl: string): string => {
  const fromEnv = process.env.PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const { hostname, origin } = new URL(requestUrl);
  const devApiOrigin = resolveTeakDevApiUrl(process.env);
  return isLocalApiHost(hostname) || origin === devApiOrigin
    ? origin
    : PROD_PUBLIC_API_URL;
};

export const getMcpEndpointFromRequestUrl = (requestUrl: string): string =>
  getPublicMcpUrl(requestUrl);

export const getPublicMcpUrl = (requestUrl: string): string => {
  const fromEnv = process.env.PUBLIC_MCP_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const apiUrlFromEnv = process.env.PUBLIC_API_URL?.trim();
  if (apiUrlFromEnv) {
    return `${normalizeBaseUrl(apiUrlFromEnv)}/mcp`;
  }

  const { hostname, origin } = new URL(requestUrl);
  const devApiOrigin = resolveTeakDevApiUrl(process.env);
  return isLocalApiHost(hostname) || origin === devApiOrigin
    ? `${origin}/mcp`
    : PROD_PUBLIC_MCP_URL;
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

export const getProtectedResourceUrl = (requestUrl: string): string => {
  const mcpUrl = new URL(getPublicMcpUrl(requestUrl));
  return `${mcpUrl.origin}/.well-known/oauth-protected-resource${mcpUrl.pathname}`;
};

export const buildProtectedResourceMetadata = (requestUrl: string) => ({
  resource: getPublicMcpUrl(requestUrl),
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

export const discoveryV1 = httpAction((_ctx, request) => {
  if (request.method === "OPTIONS") {
    return Promise.resolve(v1CorsPreflightResponse());
  }

  return Promise.resolve(
    withPublicApiGatewayHeaders(
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
    )
  );
});

export const v1CorsPreflight = httpAction(async () =>
  v1CorsPreflightResponse()
);
