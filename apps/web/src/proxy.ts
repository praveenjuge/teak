import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { workosEntryRedirect } from "@/lib/auth-entry";
import { readWorkosWebConfig } from "@/lib/workos-config";

const signInRoutes = new Set(["/sign-in", "/sign-up"]);
const publicInfrastructureRoutes = new Set(["/monitoring", "/opengraph-image"]);

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
      redirectUri: config.redirectUri,
    });
    const entry = workosEntryRedirect(request.nextUrl, Boolean(session.user));
    if (entry) {
      return handleAuthkitProxy(request, headers, { redirect: entry });
    }
    if (!(session.user || signInRoutes.has(pathname))) {
      const signIn = new URL("/sign-in", config.origin);
      signIn.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return handleAuthkitProxy(request, headers, { redirect: signIn });
    }
    return handleAuthkitProxy(request, headers);
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
  // Run on every page, including /login, /register, /forgot-password and
  // /reset-password, which have no page and exist only as redirects to AuthKit.
  // Static assets and Next internals are skipped.
  matcher: ["/((?!.*\\..*|_next).*)", "/"],
};
