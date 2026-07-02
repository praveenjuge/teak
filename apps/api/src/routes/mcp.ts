import type { Context, Hono, MiddlewareHandler } from "hono";
import { handleMcpRequest } from "../mcp/server.js";
import { json, parseBearerToken } from "../shared/http.js";
import { executeGatewayOperation } from "../shared/proxy.js";

const MCP_UNAUTHORIZED_PAYLOAD = {
  code: "UNAUTHORIZED",
  error: "Missing or invalid Authorization header",
};
const TOKEN_VALIDATION_TTL_MS = 30_000;
const MAX_VALIDATED_TOKENS = 10_000;
const validatedTokenCache = new Map<string, number>();

// Public origins used to build OAuth discovery metadata. Prefer explicit env
// config (mirrors CONVEX_HTTP_BASE_URL in shared/proxy.ts); otherwise derive
// from the request origin so dev (`api.teak.localhost:1355`) and prod
// (`api.teakvault.com`) both work without extra configuration.
const PROD_PUBLIC_API_URL = "https://api.teakvault.com";
const PROD_AUTH_ISSUER_URL = "https://app.teakvault.com";
const DEFAULT_DEV_APP_URL = "http://app.teak.localhost:1355";

const OAUTH_SCOPES_SUPPORTED = ["openid", "profile", "email", "offline_access"];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

const normalizeBaseUrl = (raw: string): string => raw.replace(/\/+$/, "");

const isLocalApiHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname.endsWith(".localhost");

const getPublicApiUrl = (requestUrl: string): string => {
  const fromEnv = process.env.PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const { origin, hostname } = new URL(requestUrl);
  return isLocalApiHost(hostname) ? origin : PROD_PUBLIC_API_URL;
};

const getAuthIssuerUrl = (requestUrl: string): string => {
  const fromEnv = process.env.AUTH_ISSUER_URL?.trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  const { hostname } = new URL(requestUrl);
  if (isLocalApiHost(hostname)) {
    const devAppUrl = process.env.TEAK_DEV_APP_URL?.trim();
    return normalizeBaseUrl(devAppUrl || DEFAULT_DEV_APP_URL);
  }

  return PROD_AUTH_ISSUER_URL;
};

const getProtectedResourceUrl = (requestUrl: string): string =>
  `${getPublicApiUrl(requestUrl)}/.well-known/oauth-protected-resource`;

// RFC 9728 protected-resource metadata. Advertises the MCP resource and the
// Teak authorization server so spec-compliant clients can begin an OAuth flow
// after a 401.
const buildProtectedResourceMetadata = (requestUrl: string) => ({
  resource: `${getPublicApiUrl(requestUrl)}/mcp`,
  authorization_servers: [getAuthIssuerUrl(requestUrl)],
  bearer_methods_supported: ["header"],
  scopes_supported: OAUTH_SCOPES_SUPPORTED,
  resource_name: "Teak",
});

const metadataResponse = (c: Context): Response =>
  new Response(JSON.stringify(buildProtectedResourceMetadata(c.req.url)), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });

const corsPreflight = (): Response =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

// Attach an RFC 9728 auth challenge so MCP clients know where to discover the
// authorization server. Applied to every 401 emitted by the bearer guard.
const withAuthChallenge = (
  response: Response,
  requestUrl: string
): Response => {
  const headers = new Headers(response.headers);
  headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${getProtectedResourceUrl(requestUrl)}"`
  );
  const exposed = headers.get("Access-Control-Expose-Headers");
  headers.set(
    "Access-Control-Expose-Headers",
    exposed?.toLowerCase().includes("www-authenticate")
      ? exposed
      : [exposed, "WWW-Authenticate"].filter(Boolean).join(", ")
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const validateApiKey = async (
  authorization: string
): Promise<Response | null> => {
  const response = await executeGatewayOperation({
    method: "GET",
    path: "/v1/cards/search",
    query: { limit: 1 },
    headers: { Authorization: authorization },
  });

  return response.ok ? null : response;
};

const hasFreshValidation = (token: string, now: number): boolean => {
  const expiresAt = validatedTokenCache.get(token);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= now) {
    validatedTokenCache.delete(token);
    return false;
  }

  return true;
};

const pruneValidationCache = (now: number): void => {
  for (const [token, expiresAt] of validatedTokenCache) {
    if (expiresAt <= now) {
      validatedTokenCache.delete(token);
    }
  }

  if (validatedTokenCache.size <= MAX_VALIDATED_TOKENS) {
    return;
  }

  const overflow = validatedTokenCache.size - MAX_VALIDATED_TOKENS;
  let removed = 0;
  for (const token of validatedTokenCache.keys()) {
    validatedTokenCache.delete(token);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
};

const requireMcpBearer: MiddlewareHandler = async (c, next) => {
  // Browser MCP clients preflight before sending credentials; answer here so
  // the bearer requirement does not reject the unauthenticated OPTIONS probe.
  if (c.req.method === "OPTIONS") {
    return corsPreflight();
  }

  const token = parseBearerToken(c.req.header("authorization") ?? null);
  if (!token) {
    return withAuthChallenge(json(401, MCP_UNAUTHORIZED_PAYLOAD), c.req.url);
  }

  const now = Date.now();
  if (!hasFreshValidation(token, now)) {
    // The probe validates both `teakapi_` keys and OAuth access tokens (the
    // REST auth path accepts both), so this transparently supports either.
    const authError = await validateApiKey(`Bearer ${token}`);
    if (authError) {
      return authError.status === 401
        ? withAuthChallenge(authError, c.req.url)
        : authError;
    }

    validatedTokenCache.set(token, now + TOKEN_VALIDATION_TTL_MS);
    pruneValidationCache(now);
  }

  await next();
};

export const registerMcpRoutes = (app: Hono): void => {
  // OAuth 2.0 protected-resource metadata (RFC 9728). Unauthenticated + CORS so
  // browser clients can discover the authorization server. The `/mcp` suffix
  // variant matches clients that append the resource path.
  app.get("/.well-known/oauth-protected-resource", metadataResponse);
  app.get("/.well-known/oauth-protected-resource/mcp", metadataResponse);
  app.options("/.well-known/oauth-protected-resource", corsPreflight);
  app.options("/.well-known/oauth-protected-resource/mcp", corsPreflight);

  app.use("/mcp", requireMcpBearer);
  app.use("/mcp/", requireMcpBearer);

  app.all("/mcp", handleMcpRequest);
  app.all("/mcp/", handleMcpRequest);
};
