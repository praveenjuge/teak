"use client";

import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { useQuery } from "@teak/ui/convex-query-hooks";
import { useEffect } from "react";
import {
  buildPseudonymousSentryUser,
  SENTRY_USER_SEGMENT_TAG,
} from "@/lib/sentry-config";

/**
 * Component that syncs a pseudonymous authenticated user id to Sentry.
 * Render only after the selected provider's permanent owner gate succeeds.
 */
export function SentryUserManager() {
  const user = useQuery(api.auth.getAuthUser, {});

  useEffect(() => {
    let cancelled = false;

    void buildPseudonymousSentryUser(user?._id, user?.email)
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
  }, [user?.email, user?._id]);

  return null;
}
