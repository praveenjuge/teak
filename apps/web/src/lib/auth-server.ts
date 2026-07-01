import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { isAuthError } from "@teak/ui/lib/utils";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL environment variable");
}

const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!convexSiteUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL environment variable");
}

export const { handler, isAuthenticated, getToken, fetchAuthMutation } =
  convexBetterAuthNextJs({
    convexUrl,
    convexSiteUrl,
    jwtCache: {
      enabled: true,
      isAuthError,
    },
  });
