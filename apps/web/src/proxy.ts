import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/lib/public-app-url";

const signInRoutes = [
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
];

export default function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const isSignInRoute = signInRoutes.includes(request.nextUrl.pathname);
  const isNativeAuthRoute = request.nextUrl.pathname.startsWith("/native/auth");

  if (isNativeAuthRoute) {
    return NextResponse.next();
  }

  // Auth routes must remain reachable when a stale session cookie is present.
  // The auth route guard validates the session before redirecting signed-in
  // users; cookie presence alone cannot distinguish an expired session.
  if (isSignInRoute) {
    return NextResponse.next();
  }

  if (!(isSignInRoute || sessionCookie)) {
    return NextResponse.redirect(buildPublicAppUrl("/login", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except static assets and api routes
  matcher: ["/((?!.*\\..*|_next|api/auth).*)", "/", "/trpc(.*)"],
};
