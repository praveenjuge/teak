import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/lib/public-app-url";
import { CSP_NONCE_HEADER, securityHeaders } from "@/lib/security-headers";

const signInRoutes = [
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
];

// Browser MCP/OAuth clients (e.g. claude.ai) preflight the OAuth token endpoint
// cross-origin. The Better Auth catch-all route does not reliably answer these
// OPTIONS preflights, so respond to them here before the request reaches it.
const MCP_OAUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const createNonce = () => btoa(crypto.randomUUID());

const withSecurityHeaders = (request: NextRequest, response?: NextResponse) => {
  const nonce = createNonce();
  const requestHeaders = new Headers(request.headers);
  const headers = securityHeaders(nonce);

  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  for (const { key, value } of headers) {
    requestHeaders.set(key, value);
  }

  const nextResponse =
    response ??
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

  for (const { key, value } of headers) {
    nextResponse.headers.set(key, value);
  }

  return nextResponse;
};

export default function middleware(request: NextRequest) {
  // MCP OAuth endpoints: answer CORS preflight here; pass everything else
  // (authorize redirects, token POSTs) straight through to the auth handler.
  if (request.nextUrl.pathname.startsWith("/api/auth/mcp/")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: MCP_OAUTH_CORS_HEADERS,
      });
    }
    return withSecurityHeaders(request);
  }

  const sessionCookie = getSessionCookie(request);
  const isSignInRoute = signInRoutes.includes(request.nextUrl.pathname);
  const isNativeAuthRoute = request.nextUrl.pathname.startsWith("/native/auth");

  if (isNativeAuthRoute) {
    return withSecurityHeaders(request);
  }

  // Auth routes must remain reachable when a stale session cookie is present.
  // The auth route guard validates the session before redirecting signed-in
  // users; cookie presence alone cannot distinguish an expired session.
  if (isSignInRoute) {
    return withSecurityHeaders(request);
  }

  if (!(isSignInRoute || sessionCookie)) {
    return withSecurityHeaders(
      request,
      NextResponse.redirect(buildPublicAppUrl("/login", request.nextUrl))
    );
  }

  return withSecurityHeaders(request);
}

export const config = {
  // Run middleware on all routes except static assets and api routes. The MCP
  // OAuth subpaths are re-included so we can answer their CORS preflight.
  matcher: [
    "/((?!.*\\..*|_next|api/auth).*)",
    "/",
    "/trpc(.*)",
    "/api/auth/mcp/:path*",
  ],
};
