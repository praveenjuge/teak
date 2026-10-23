import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { workosEntryRedirect } from "@/lib/auth-entry";
import { resolveAnalyticsProxyTarget } from "@/lib/posthog-config";
import { syncSessionHint } from "@/lib/session-hint";
import { readWorkosWebConfig } from "@/lib/workos-config";

const signInRoutes = new Set(["/sign-in", "/sign-up"]);
const publicInfrastructureRoutes = new Set(["/opengraph-image"]);

// Same-origin PostHog proxy. It never sits behind sign-in, and it drops the
// browser's cookies: Teak's session must not reach a third party, and the
// large WorkOS cookie overflows the asset bucket's 8 KB header limit.
const proxyAnalytics = (request: NextRequest, target: URL) => {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  return NextResponse.rewrite(target, { request: { headers } });
};

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
    const { session, headers } = await authkit(request, {
      // Page loads also carry the access token in a 30-second cookie that the
      // client reads (and deletes) as it starts, so Convex signs in without
      // first asking the server for a token.
      eagerAuth: true,
      redirectUri: config.redirectUri,
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
    if (!(signedIn || signInRoutes.has(pathname))) {
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
