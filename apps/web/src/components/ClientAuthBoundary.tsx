"use client";

import { AuthBoundary } from "@convex-dev/better-auth/react";
import { api } from "@teak/convex";
import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { isAuthError } from "@teak/ui/lib/utils";
import { type ReactNode, useEffect, useRef } from "react";
import Loading from "@/app/loading";
import { authClient, convexAuthClient } from "@/lib/auth-client";

export function ClientAuthBoundary({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const establishedUserId = useRef(userId);

  if (establishedUserId.current === null && userId !== null) {
    establishedUserId.current = userId;
  }

  // The query cache owns subscriptions on a shared Convex client. A new cache
  // key cannot clear that client's values before its authentication updates.
  const accountChanged =
    establishedUserId.current !== null &&
    userId !== null &&
    userId !== establishedUserId.current;

  useEffect(() => {
    if (accountChanged) {
      window.location.reload();
    }
  }, [accountChanged]);

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
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }}
    >
      {session && !accountChanged ? (
        <ConvexQueryCacheProvider key={session.user.id}>
          {children}
        </ConvexQueryCacheProvider>
      ) : (
        <Loading />
      )}
    </AuthBoundary>
  );
}
