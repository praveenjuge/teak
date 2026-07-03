import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

interface UserInfo {
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub: string;
}

const getOAuthUserInfo = makeFunctionReference<
  "query",
  { token: string },
  UserInfo | null
>("oauthTokens:getOAuthUserInfo");

const getConvexUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL environment variable");
  }
  return url;
};

const getConvexSiteUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL environment variable");
  }
  return url.replace(/\/$/, "");
};

const parseBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!(scheme && token) || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
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

const unauthorized = (): Response =>
  jsonResponse(
    401,
    {
      error: "invalid_token",
      error_description: "Missing, invalid, or expired access token",
    },
    { "WWW-Authenticate": "Bearer" }
  );

const readToken = async (request: Request): Promise<string | null> => {
  const headerToken = parseBearerToken(request);
  if (headerToken) {
    return headerToken;
  }

  if (request.method !== "POST") {
    return null;
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return null;
  }

  const form = new URLSearchParams(await request.text());
  return form.get("access_token")?.trim() || null;
};

export async function mcpUserInfo(request: Request): Promise<Response> {
  const token = await readToken(request);
  if (!token) {
    return unauthorized();
  }

  const client = new ConvexHttpClient(getConvexUrl());
  const userInfo = await client.query(getOAuthUserInfo, { token });
  if (!userInfo) {
    return unauthorized();
  }

  return jsonResponse(200, userInfo, { "Cache-Control": "no-store" });
}

export async function mcpJwks(): Promise<Response> {
  const response = await fetch(`${getConvexSiteUrl()}/api/auth/convex/jwks`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    return jsonResponse(502, {
      error: "server_error",
      error_description: "JWKS is unavailable",
    });
  }

  return jsonResponse(200, await response.json(), {
    "Cache-Control": "no-store",
  });
}

export function mcpOAuthPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
