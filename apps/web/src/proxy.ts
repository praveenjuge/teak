import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

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

  if (isSignInRoute && !sessionCookie) {
    return NextResponse.next();
  }

  if (!(isSignInRoute || sessionCookie)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isSignInRoute && sessionCookie) {
    const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
    if (nextPath) {
      return NextResponse.redirect(new URL(nextPath, request.url));
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except static assets and api routes
  matcher: ["/((?!.*\\..*|_next|api/auth).*)", "/", "/trpc(.*)"],
};
