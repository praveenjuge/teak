import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/lib/public-app-url";

const signInRoutes = [
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
];

const isPublicRoute = createRouteMatcher([
  "/login(.*)",
  "/register(.*)",
  "/forgot-password(.*)",
  "/reset-password(.*)",
  "/desktop/auth(.*)",
]);

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

export default clerkMiddleware(async (auth, request) => {
  const authState = await auth();
  const isSignInRoute = signInRoutes.includes(request.nextUrl.pathname);

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  if (isSignInRoute && authState.userId) {
    const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
    if (nextPath) {
      return NextResponse.redirect(
        buildPublicAppUrl(nextPath, request.nextUrl)
      );
    }
    return NextResponse.redirect(buildPublicAppUrl("/", request.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
