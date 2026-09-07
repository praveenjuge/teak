import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { isAuthError } from "@teak/ui/lib/utils";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_URL environment variable (run: bun run setup, expected http://127.0.0.1:3210 locally)"
  );
}

const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!convexSiteUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_SITE_URL environment variable (run: bun run setup, expected http://127.0.0.1:3211 locally)"
  );
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
