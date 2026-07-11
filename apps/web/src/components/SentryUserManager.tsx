"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { buildPseudonymousSentryUser } from "@/lib/sentry-config";

/**
 * Component that syncs a pseudonymous authenticated user id to Sentry.
 * Must be rendered within the ConvexBetterAuthProvider tree.
 */
export function SentryUserManager() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    let cancelled = false;

    void buildPseudonymousSentryUser(session?.user.id)
      .then((user) => {
        if (!cancelled) {
          Sentry.setUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          Sentry.setUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  return null;
}
