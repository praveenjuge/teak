"use client";

import { AuthBoundary } from "@convex-dev/better-auth/react";
import { api } from "@teak/convex";
import { isAuthError } from "@teak/ui/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

export function ClientAuthBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <AuthBoundary
      authClient={authClient}
      getAuthUserFn={(api as any).auth.getAuthUser}
      isAuthError={isAuthError}
      onUnauth={() => {
        const query = searchParams.toString();
        const next = query ? `${pathname}?${query}` : pathname;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }}
    >
      {children}
    </AuthBoundary>
  );
}
