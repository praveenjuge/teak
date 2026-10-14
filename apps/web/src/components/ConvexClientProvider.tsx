"use client";

import { preloadCardModal } from "@teak/ui/card-modal/lazy";
import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { firstLoadQueries } from "@teak/ui/lib/firstLoadQueries";
import { whenIdle } from "@teak/ui/lib/lazyWithPreload";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { type ReactNode, useCallback, useEffect } from "react";
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
// The first token comes fresh from the page load (AuthKit's eagerAuth), so
// the client keeps it until it nears expiry instead of fetching another at
// once, which would make the server run every query a second time. The
// option is experimental in Convex.
const convex = new ConvexReactClient(getConvexUrl(), {
  expectAuth: true,
  initialAuthTokenReuse: true,
  unsavedChangesWarning: false,
});

// How long the page's first queries stay subscribed on their own: long
// enough for a slow connection to reach the components that use them.
const FIRST_LOAD_QUERY_HOLD_MS = 30_000;

// In the browser, subscribe to the page's first queries as this module
// loads. That opens the socket while the page hydrates, and the queries go
// out with the client's sign-in, so the profile, sidebar and first cards
// arrive together instead of each waiting for the component before it.
// Only signed-in pages load this module; signed out, they wait unanswered.
if (typeof window !== "undefined") {
  for (const { query, args } of firstLoadQueries(
    new URL(window.location.href)
  )) {
    convex.prewarmQuery({
      query,
      args,
      extendSubscriptionFor: FIRST_LOAD_QUERY_HOLD_MS,
    });
  }
}

export default function ConvexClientProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
}) {
  const signedIn = Boolean(initialAuth?.user);
  // The card dialog (with the editor) loads while the first queries are in
  // flight, once the page is idle, so a card clicked the moment it appears
  // opens at once.
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    return whenIdle(() => {
      preloadCardModal().catch(() => {
        // Opening a card retries the load.
      });
    });
  }, [signedIn]);

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
