"use client";

import { api } from "@teak/convex";
import { useQuery } from "@teak/ui/convex-query-hooks";
import { useEffect } from "react";
import { identifyPostHogUser } from "@/lib/posthog-client";

/**
 * Links product analytics to the signed-in Teak account. Render only after the
 * permanent owner gate succeeds, so the id is the canonical Teak user id.
 */
export function PostHogIdentify() {
  const user = useQuery(api.auth.getAuthUser, {});

  useEffect(() => {
    if (user?._id) {
      identifyPostHogUser(user._id, user.email ?? undefined);
    }
  }, [user?._id, user?.email]);

  return null;
}
