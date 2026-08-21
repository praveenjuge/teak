"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import {
  buildPseudonymousSentryUser,
  SENTRY_USER_SEGMENT_TAG,
} from "@/lib/sentry-config";

/**
 * Component that syncs a pseudonymous authenticated user id to Sentry.
 * Must be rendered within the ConvexBetterAuthProvider tree.
 */
export function SentryUserManager() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    let cancelled = false;

    void buildPseudonymousSentryUser(session?.user.id, session?.user.email)
      .then((user) => {
        if (!cancelled) {
          Sentry.setTag(SENTRY_USER_SEGMENT_TAG, user?.segment);
          Sentry.setUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          Sentry.setTag(SENTRY_USER_SEGMENT_TAG, undefined);
          Sentry.setUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user.email, session?.user.id]);

  return null;
}
