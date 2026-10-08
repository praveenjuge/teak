"use client";

import { CardContent } from "@teak/ui/components/ui/card";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AuthCardLoading } from "@/app/(auth)/AuthCardLoading";
import { workosStartUrl } from "@/lib/auth-entry";
import { getSafeNextPath } from "@/lib/safe-next-path";
import { useAuthMode } from "./AuthModeProvider";

type Flow = "signin" | "signup" | "recovery";

// These pages are Better Auth forms. Under WorkOS the proxy redirects them to
// hosted AuthKit before they render; this hand-off only covers navigations
// that skip it.
export function AuthPageMode({
  children,
  flow,
}: {
  children: ReactNode;
  flow: Flow;
}) {
  const mode = useAuthMode();
  if (!mode) {
    return <AuthCardLoading />;
  }
  if (mode.primary === "workos") {
    return <WorkosHandoff signup={flow === "signup"} />;
  }
  if (flow === "recovery" && mode.accountChangesPaused) {
    return (
      <CardContent>
        <p role="status">Account changes are paused. Please try again later.</p>
        <Link href="/login">Back to sign in</Link>
      </CardContent>
    );
  }
  return children;
}

function WorkosHandoff({ signup }: { signup: boolean }) {
  const next = getSafeNextPath(useSearchParams().get("next"));
  useEffect(() => {
    window.location.replace(
      workosStartUrl(window.location.origin, signup, next).toString()
    );
  }, [next, signup]);
  return <AuthCardLoading />;
}
