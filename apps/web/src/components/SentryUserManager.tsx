"use client";

import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Component that syncs the authenticated user's data to Sentry and PostHog.
 * This enables better error tracking and user identification.
 * Must be rendered within the ClerkProvider tree.
 */
export function SentryUserManager() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        username: user.fullName || user.username || undefined,
      });
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName || undefined,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [isLoaded, user]);

  return null;
}
