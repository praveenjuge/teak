"use client";

import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { type ReactNode, useCallback } from "react";
import { getConvexUrl } from "@/lib/public-env";

// One client for the page's lifetime, created before the first render so the
// socket opens without waiting for an effect. The client is lazy, so server
// rendering never connects. It is never closed: React replays effects in
// development and hides routes with Activity, and closing a client that
// mounted auth or subscription effects still use would break them.
const convex = new ConvexReactClient(getConvexUrl(), { expectAuth: true });

export default function ConvexClientProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
}) {
  return (
    <AuthKitProvider initialAuth={initialAuth}>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function useAuthFromAuthKit() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) {
        return null;
      }
      try {
        return (
          (await (forceRefreshToken ? refresh() : getAccessToken())) ?? null
        );
      } catch {
        return null;
      }
    },
    [user, refresh, getAccessToken]
  );
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}
