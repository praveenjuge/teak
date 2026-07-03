// RFC 8414 requires the authorization-server metadata to be reachable at the
// issuer root (https://app.teakvault.com/.well-known/...). Better Auth's `mcp`
// plugin serves that document from the Convex deployment under
// `/api/auth/.well-known/oauth-authorization-server`, so these root routes are
// thin same-origin proxies. The metadata already advertises the web-origin
// endpoints (`.../api/auth/mcp/*`), so no rewriting is needed.

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

  return jsonResponse(200, metadata);
}

export function oauthMetadataPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
