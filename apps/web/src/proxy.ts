import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { workosEntryRedirect } from "@/lib/auth-entry";
import { resolveAnalyticsProxyTarget } from "@/lib/posthog-config";
import { SIGN_IN_ROUTES } from "@/lib/safe-next-path";
import { syncSessionHint } from "@/lib/session-hint";
import { readWorkosWebConfig } from "@/lib/workos-config";

// /share takes a POST from the share sheet, which a sign-in redirect would
// drop; it only redirects on to the library, which then asks for sign-in.
const publicInfrastructureRoutes = new Set(["/opengraph-image", "/share"]);

// Same-origin PostHog proxy. It never sits behind sign-in, and it drops the
// browser's cookies: Teak's session must not reach a third party, and the
// large WorkOS cookie overflows the asset bucket's 8 KB header limit.
const proxyAnalytics = (request: NextRequest, target: URL) => {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  return NextResponse.rewrite(target, { request: { headers } });
};

const hasPkceCookie = (response: NextResponse) =>
  response.headers
    .getSetCookie()
    .some((cookie) => cookie.startsWith("wos-auth-verifier"));

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const analyticsTarget = resolveAnalyticsProxyTarget(request.nextUrl);
  if (analyticsTarget) {
    return proxyAnalytics(request, analyticsTarget);
  }
  if (publicInfrastructureRoutes.has(pathname)) {
    return NextResponse.next();
  }
  if (pathname === "/callback") {
    return handleAuthkitProxy(request, new Headers());
  }

  try {
    const config = readWorkosWebConfig();
    if (request.nextUrl.origin !== config.origin) {
      return new NextResponse("Invalid sign-in origin.", { status: 400 });
    }
    const { session, headers, authorizationUrl } = await authkit(request, {
      // Page loads also carry the access token in a 30-second cookie that the
      // client reads (and deletes) as it starts, so Convex signs in without
      // first asking the server for a token.
      eagerAuth: true,
      redirectUri: config.redirectUri,
      // The client renews its token 60 seconds before expiry through a
      // server action that refreshes the session itself. Refreshing here only
      // in the last 30 seconds keeps that request to one WorkOS refresh.
      refreshBufferSeconds: 30,
    });
    const signedIn = Boolean(session.user);
    const respond = (response: NextResponse) => {
      syncSessionHint(
        request.cookies,
        response.headers,
        config.origin,
        signedIn
      );
      return response;
    };
    const entry = workosEntryRedirect(request.nextUrl, signedIn);
    if (entry) {
      return respond(handleAuthkitProxy(request, headers, { redirect: entry }));
    }
    if (!(signedIn || SIGN_IN_ROUTES.has(pathname))) {
      // A page load goes straight to AuthKit with the SDK's PKCE cookie. The
      // SDK sets that cookie only for document loads; anything else (a router
      // fetch can't follow the cross-origin hop) goes through /sign-in.
      if (authorizationUrl) {
        const direct = handleAuthkitProxy(request, headers, {
          redirect: authorizationUrl,
        });
        if (hasPkceCookie(direct)) {
          return respond(direct);
        }
      }
      const signIn = new URL("/sign-in", config.origin);
      signIn.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return respond(
        handleAuthkitProxy(request, headers, { redirect: signIn })
      );
    }
    return respond(handleAuthkitProxy(request, headers));
  } catch {
    return new NextResponse(
      "Sign-in is temporarily unavailable. Please reload to try again.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/ingest/:path*"],
};
