import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { isAuthError } from "@teak/ui/lib/utils";
import { getConvexSiteUrl, getConvexUrl } from "@/lib/public-env";

const convexUrl = getConvexUrl();
const convexSiteUrl = getConvexSiteUrl();

export const { handler, isAuthenticated, getToken, fetchAuthMutation } =
  convexBetterAuthNextJs({
    convexUrl,
    convexSiteUrl,
    jwtCache: {
      enabled: true,
      isAuthError,
    },
  });
