"use client";

import { CardContent } from "@teak/ui/components/ui/card";
import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import { AuthCardLoading } from "@/app/(auth)/AuthCardLoading";
import { useAuthMode } from "./AuthModeProvider";

type Flow = "signin" | "signup" | "recovery";

// These pages are Better Auth forms. Under WorkOS the proxy redirects them to
// hosted AuthKit before they render; a client-side navigation that skipped it
// reloads so the proxy can.
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
    return <WorkosHandoff />;
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

function WorkosHandoff() {
  useEffect(() => {
    window.location.reload();
  }, []);
  return <AuthCardLoading />;
}
