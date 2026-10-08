"use client";

import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import Loading from "@/app/loading";
import { getConvexUrl } from "@/lib/public-env";

const convexUrl = getConvexUrl();

export default function ConvexClientProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
}) {
  const [convex, setConvex] = useState<ConvexReactClient | null>(null);
  useEffect(() => {
    const client = new ConvexReactClient(convexUrl, { expectAuth: true });
    setConvex(client);
    return () => {
      // Auth and subscription effects must detach before the client closes.
      // Each effect setup owns a fresh client, including development replay.
      queueMicrotask(() => {
        void client.close();
      });
    };
  }, []);
  if (!convex) {
    return <Loading />;
  }
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
