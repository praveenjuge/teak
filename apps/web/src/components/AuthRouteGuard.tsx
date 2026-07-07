"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { getSafeNextPath } from "@/lib/safe-next-path";

export function AuthRouteGuard({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const nextPath = getSafeNextPath(searchParams.get("next")) ?? "/";

  useEffect(() => {
    if (session) {
      window.location.replace(
        new URL(nextPath, window.location.origin).toString()
      );
    }
  }, [nextPath, session]);

  if (isPending || session) {
    return fallback;
  }

  return <>{children}</>;
}
