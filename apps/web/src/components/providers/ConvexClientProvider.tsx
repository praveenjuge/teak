"use client";

import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { type ReactNode, useCallback, useRef } from "react";
import { convex } from "@/lib/convexClient";
import { QuerySeedsProvider } from "@/lib/convexQueryHooks";
import type { QuerySeed } from "@/lib/firstLoadQueries";
import { fetchSessionToken, newerSessionToken } from "@/lib/session-token";

export default function ConvexClientProvider({
  children,
  initialAuth,
  seeds = [],
}: {
  children: ReactNode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
  seeds?: readonly QuerySeed[];
}) {
  return (
    <AuthKitProvider initialAuth={initialAuth}>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <QuerySeedsProvider seeds={seeds}>
          <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
        </QuerySeedsProvider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function useAuthFromAuthKit() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const handedOut = useRef<string | null>(null);
  const nextToken = useCallback(
    () => newerSessionToken(handedOut.current, getAccessToken, refresh),
    [getAccessToken, refresh]
  );
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) {
        return null;
      }
      const token = await fetchSessionToken(
        forceRefreshToken ? nextToken : getAccessToken
      );
      handedOut.current = token;
      return token;
    },
    [user, nextToken, getAccessToken]
  );
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}
