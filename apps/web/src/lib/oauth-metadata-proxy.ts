// RFC 8414 requires the authorization-server metadata to be reachable at the
// issuer root (https://app.teakvault.com/.well-known/...). Better Auth's legacy
// MCP plugin serves that document from the Convex deployment under
// `/api/auth/.well-known/oauth-authorization-server`. Normalize it here so the
// public document only advertises endpoints and scopes this deployment actually
// supports for the opaque-token MCP/API flow.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// Both `/.well-known/oauth-authorization-server` (RFC 8414) and
// `/.well-known/openid-configuration` (OIDC Discovery) resolve to the same
// authorization-server document; the plugin only exposes the former upstream.
const UPSTREAM_PATH = "/api/auth/.well-known/oauth-authorization-server";
const PUBLIC_SCOPES = ["profile", "email", "offline_access"] as const;

const getConvexSiteUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL environment variable");
  }
  return url.replace(/\/$/, "");
};

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...headers,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

const normalizeAuthorizationServerMetadata = (
  metadata: unknown
): Record<string, unknown> | null => {
  if (!isRecord(metadata) || typeof metadata.issuer !== "string") {
    return null;
  }

  const issuer = metadata.issuer.replace(/\/$/, "");
  const normalized: Record<string, unknown> = {
    issuer,
    authorization_endpoint:
      typeof metadata.authorization_endpoint === "string"
        ? metadata.authorization_endpoint
        : `${issuer}/api/auth/mcp/authorize`,
    token_endpoint:
      typeof metadata.token_endpoint === "string"
        ? metadata.token_endpoint
        : `${issuer}/api/auth/mcp/token`,
    registration_endpoint:
      typeof metadata.registration_endpoint === "string"
        ? metadata.registration_endpoint
        : `${issuer}/api/auth/mcp/register`,
    userinfo_endpoint: `${issuer}/api/auth/mcp/userinfo`,
    jwks_uri: `${issuer}/api/auth/mcp/jwks`,
    scopes_supported: PUBLIC_SCOPES,
    bearer_methods_supported: ["header"],
  };

  for (const field of [
    "response_types_supported",
    "response_modes_supported",
    "grant_types_supported",
    "token_endpoint_auth_methods_supported",
    "code_challenge_methods_supported",
  ]) {
    const value = stringArray(metadata[field]);
    if (value) {
      normalized[field] = value;
    }
  }

  return normalized;
};

export async function proxyAuthorizationServerMetadata(): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${getConvexSiteUrl()}${UPSTREAM_PATH}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return jsonResponse(502, {
      error: "server_error",
      error_description: "Failed to reach authorization server metadata",
    });
  }

  if (!upstream.ok) {
    return jsonResponse(502, {
      error: "server_error",
      error_description: "Authorization server metadata is unavailable",
    });
  }

  let metadata: unknown;
  try {
    metadata = await upstream.json();
  } catch {
    return jsonResponse(502, {
      error: "server_error",
      error_description: "Authorization server metadata is malformed",
    });
  }

  const normalized = normalizeAuthorizationServerMetadata(metadata);
  if (!normalized) {
    return jsonResponse(502, {
      error: "server_error",
      error_description: "Authorization server metadata is malformed",
    });
  }

  return jsonResponse(200, normalized);
}

export function oauthMetadataPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
