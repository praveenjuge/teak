import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/lib/public-app-url";

const signInRoutes = [
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
];

function getSafeNextPath(rawNext: string | null): string | null {
  if (!(rawNext?.startsWith("/") && !rawNext.startsWith("//"))) {
    return null;
  }

  const targetPath = rawNext.split("?")[0] ?? rawNext;
  if (signInRoutes.includes(targetPath)) {
    return null;
  }

  return rawNext;
}

export default function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const isSignInRoute = signInRoutes.includes(request.nextUrl.pathname);
  const isDesktopAuthRoute =
    request.nextUrl.pathname.startsWith("/desktop/auth");

  if (isDesktopAuthRoute) {
    return NextResponse.next();
  }

  if (isSignInRoute && !sessionCookie) {
    return NextResponse.next();
  }

  if (!(isSignInRoute || sessionCookie)) {
    return NextResponse.redirect(buildPublicAppUrl("/login", request.nextUrl));
  }

  if (isSignInRoute && sessionCookie) {
    const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
    if (nextPath) {
      return NextResponse.redirect(
        buildPublicAppUrl(nextPath, request.nextUrl)
      );
    }
    return NextResponse.redirect(buildPublicAppUrl("/", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except static assets and api routes
  matcher: ["/((?!.*\\..*|_next|api/auth).*)", "/", "/trpc(.*)"],
};
