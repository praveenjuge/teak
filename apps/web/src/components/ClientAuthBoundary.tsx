"use client";

import { AuthBoundary } from "@convex-dev/better-auth/react";
import { api } from "@teak/convex";
import { isAuthError } from "@teak/ui/lib/utils";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { convexAuthClient } from "@/lib/auth-client";

export function ClientAuthBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <AuthBoundary
      authClient={convexAuthClient}
      getAuthUserFn={(api as any).auth.getAuthUser}
      isAuthError={isAuthError}
      onUnauth={() => {
        // Read the current location lazily inside the handler so this
        // boundary doesn't re-render on every pathname / query change.
        const { pathname, search } = window.location;
        const next = `${pathname}${search}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }}
    >
      {children}
    </AuthBoundary>
  );
}
