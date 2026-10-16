"use client";

import { useEffect } from "react";
import { identifyPostHogUser } from "@/lib/posthog-client";

export function PostHogIdentify({
  email,
  teakUserId,
}: {
  email: string | undefined;
  teakUserId: string;
}) {
  useEffect(() => {
    identifyPostHogUser(teakUserId, email);
  }, [teakUserId, email]);

  return null;
}
