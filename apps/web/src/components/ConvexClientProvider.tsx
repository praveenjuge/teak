"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
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
import { convexAuthClient } from "@/lib/auth-client";
import { type PublicAuthMode, sameAuthProvider } from "@/lib/auth-mode";
import { getConvexUrl } from "@/lib/public-env";
import { useAuthMode } from "./AuthModeProvider";

const convexUrl = getConvexUrl();

export default function ConvexClientProvider({
  children,
  initialToken,
  initialMode,
  initialAuth,
}: {
  children: ReactNode;
  initialToken?: string | null;
  initialMode: PublicAuthMode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
}) {
  const liveMode = useAuthMode();
  const changed =
    liveMode !== undefined && !sameAuthProvider(initialMode, liveMode);
  useEffect(() => {
    if (changed) {
      window.location.reload();
    }
  }, [changed]);
  if (!liveMode || changed) {
    return <Loading />;
  }
  return (
    <SelectedProvider
      initialAuth={initialAuth}
      initialToken={initialToken}
      key={`${initialMode.primary}:${initialMode.authKitClientId ?? ""}`}
      primary={initialMode.primary}
    >
      {children}
    </SelectedProvider>
  );
}

function SelectedProvider({
  children,
  primary,
  initialToken,
  initialAuth,
}: {
  children: ReactNode;
  primary: PublicAuthMode["primary"];
  initialToken?: string | null;
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
  if (primary === "workos") {
    return (
      <AuthKitProvider initialAuth={initialAuth}>
        <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
          <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
        </ConvexProviderWithAuth>
      </AuthKitProvider>
    );
  }
  return (
    <ConvexBetterAuthProvider
      authClient={convexAuthClient}
      client={convex}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
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
