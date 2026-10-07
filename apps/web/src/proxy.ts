import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { readAuthMode, readProxyAuthMode } from "@/lib/auth-mode-server";
import { buildPublicAppUrl } from "@/lib/public-app-url";
import { readWorkosWebConfig } from "@/lib/workos-config";

const signInRoutes = [
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
  "/sign-in",
];
const publicInfrastructureRoutes = new Set(["/monitoring", "/opengraph-image"]);

// Browser MCP/OAuth clients (e.g. claude.ai) preflight the OAuth token endpoint
// cross-origin. The Better Auth catch-all route does not reliably answer these
// OPTIONS preflights, so respond to them here before the request reaches it.
const MCP_OAUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default async function middleware(request: NextRequest) {
  // MCP OAuth endpoints: answer CORS preflight here; pass everything else
  // (authorize redirects, token POSTs) straight through to the auth handler.
  if (request.nextUrl.pathname.startsWith("/api/auth/mcp/")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: MCP_OAUTH_CORS_HEADERS,
      });
    }
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  const isSignInRoute = signInRoutes.includes(request.nextUrl.pathname);
  const isNativeAuthRoute = request.nextUrl.pathname.startsWith("/native/auth");

  if (publicInfrastructureRoutes.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (isNativeAuthRoute) {
    return NextResponse.next();
  }

  try {
    const routing = await readProxyAuthMode();
    // A cached mode may route optimistically. Refresh before reading or
    // refreshing any provider credential, and before auth entry/callbacks.
    const mode =
      routing.primary === "workos" ||
      isSignInRoute ||
      request.nextUrl.pathname === "/callback"
        ? await readAuthMode()
        : routing;
    if (request.nextUrl.pathname === "/callback") {
      return handleAuthkitProxy(request, new Headers());
    }
    if (mode.primary === "workos") {
      const config = readWorkosWebConfig(mode);
      if (request.nextUrl.origin !== config.origin) {
        return new NextResponse("Invalid sign-in origin.", { status: 400 });
      }
      const { session, headers } = await authkit(request, {
        redirectUri: config.redirectUri,
      });
      if (!(session.user || isSignInRoute)) {
        const login = new URL("/login", config.origin);
        login.searchParams.set(
          "next",
          `${request.nextUrl.pathname}${request.nextUrl.search}`
        );
        return handleAuthkitProxy(request, headers, { redirect: login });
      }
      return handleAuthkitProxy(request, headers);
    }
  } catch {
    return new NextResponse(
      "Sign-in is temporarily unavailable. Please reload to try again.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  // Auth routes must remain reachable when a stale session cookie is present.
  // The auth route guard validates the session before redirecting signed-in
  // users; cookie presence alone cannot distinguish an expired session.
  if (isSignInRoute) {
    return handleAuthkitProxy(request, new Headers());
  }

  if (!(isSignInRoute || sessionCookie)) {
    return NextResponse.redirect(buildPublicAppUrl("/login", request.nextUrl));
  }

  return handleAuthkitProxy(request, new Headers());
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
