"use client";

import { api } from "@teak/convex";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { preloadCardModal } from "@/components/card-modal/LazyCardModal";
import { ConvexQueryCacheProvider } from "@/lib/convexQueryCache";
import { QuerySeedsProvider } from "@/lib/convexQueryHooks";
import { firstLoadQueries, type QuerySeed } from "@/lib/firstLoadQueries";
import { whenIdle } from "@/lib/lazyWithPreload";
import { getConvexUrl } from "@/lib/public-env";
import { fetchSessionToken, newerSessionToken } from "@/lib/session-token";

// Never closed: React replays effects in development and hides routes with
// Activity, and closing a client that mounted auth or subscription effects
// still use would break them. Convex raises its unsaved-changes prompt for
// any request in flight, reads included. The first token comes fresh from the
// page load (AuthKit's eagerAuth), so initialAuthTokenReuse keeps it until it
// nears expiry instead of fetching another at once, which would make the
// server run every query a second time; the option is experimental in Convex.
const convex = new ConvexReactClient(getConvexUrl(), {
  expectAuth: true,
  initialAuthTokenReuse: true,
  unsavedChangesWarning: false,
});

const FIRST_LOAD_QUERY_HOLD_MS = 30_000;

function prewarmFirstLoadQueries() {
  if (typeof window === "undefined") {
    return;
  }
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
prewarmFirstLoadQueries();

const INTENT_QUERY_HOLD_MS = 15_000;

export function prewarmRouteQueries(href: string) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    return;
  }
  for (const { query, args } of firstLoadQueries(url, {
    folders: loadedFolders(),
  })) {
    convex.prewarmQuery({
      query,
      args,
      extendSubscriptionFor: INTENT_QUERY_HOLD_MS,
    });
  }
}

function loadedFolders() {
  try {
    return convex.watchQuery(api.folders.listFolders, {}).localQueryResult();
  } catch {
    return [];
  }
}

export default function ConvexClientProvider({
  children,
  initialAuth,
  seeds = [],
}: {
  children: ReactNode;
  initialAuth?: Omit<UserInfo | NoUserInfo, "accessToken">;
  /** Results of the first-load queries, fetched by the server for this page. */
  seeds?: readonly QuerySeed[];
}) {
  const signedIn = Boolean(initialAuth?.user);
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    return whenIdle(() => {
      preloadCardModal().catch(() => undefined);
    });
  }, [signedIn]);

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
