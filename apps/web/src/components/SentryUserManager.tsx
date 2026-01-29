"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { authClient } from "@/lib/auth-client";

/**
 * Component that syncs the authenticated user's data to Sentry.
 * This enables better error tracking and user identification in Sentry.
 * Must be rendered within the ConvexBetterAuthProvider tree.
 */
export function SentryUserManager() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session?.user) {
      // Set user data when logged in
      Sentry.setUser({
        id: session.user.id,
        email: session.user.email,
        username: session.user.name || undefined,
      });
    } else {
      // Clear user data when logged out
      Sentry.setUser(null);
    }
  }, [session]);

  return null;
}
