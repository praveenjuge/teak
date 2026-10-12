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
import { fetchSessionToken } from "@/lib/session-token";

// One client for the page's lifetime, created before the first render so the
// socket opens without waiting for an effect. The client is lazy, so server
// rendering never connects. It is never closed: React replays effects in
// development and hides routes with Activity, and closing a client that
// mounted auth or subscription effects still use would break them.
// No unsaved-changes prompt: the client raises it for any request in flight,
// and here that is mostly reads such as Settings' device list, so it warned
// people who were only navigating or signing out. Writes are short mutations.
const convex = new ConvexReactClient(getConvexUrl(), {
  expectAuth: true,
  unsavedChangesWarning: false,
});

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
      return await fetchSessionToken(
        forceRefreshToken ? refresh : getAccessToken
      );
    },
    [user, refresh, getAccessToken]
  );
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}
