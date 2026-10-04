import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { api } from "@teak/convex";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { useNetworkState } from "expo-network";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Platform } from "react-native";
import { hasStoredBetterAuthSessionCookie } from "./auth-bootstrap";
import { authClient, convexAuthClient } from "./auth-client";
import type { PublicAuthMode } from "./auth-mode";
import { refreshAuthSessionCache } from "./auth-session-cache";
import { MobileAuthContext } from "./mobile-auth-context";
import {
  getWorkosSession,
  openWorkosLogout,
  signInWithWorkos,
} from "./workos-native-auth";

function storedCookie() {
  try {
    const client = authClient as typeof authClient & {
      getCookie?: () => string;
    };
    return (
      Platform.OS !== "web" &&
      hasStoredBetterAuthSessionCookie(client.getCookie?.() ?? null)
    );
  } catch {
    return false;
  }
}
export function BetterAuthProvider({
  client,
  mode,
  children,
}: {
  client: ConvexReactClient;
  mode: PublicAuthMode;
  children: ReactNode;
}) {
  const { data, isPending } = authClient.useSession();
  const value = useMemo(
    () => ({
      mode,
      isPending,
      hasStoredSession: storedCookie(),
      user: data?.user
        ? {
            email: data.user.email,
            name: data.user.name,
            teakUserId: data.user.id,
          }
        : null,
      refreshSession: refreshAuthSessionCache,
      signIn: () =>
        Promise.reject(new Error("Use the Better Auth sign-in flow")),
      signOut: async () => {
        await authClient.signOut();
      },
    }),
    [mode, data, isPending]
  );
  return (
    <ConvexBetterAuthProvider authClient={convexAuthClient} client={client}>
      <MobileAuthContext.Provider value={value}>
        {children}
      </MobileAuthContext.Provider>
    </ConvexBetterAuthProvider>
  );
}
export function WorkosAuthProvider({
  client,
  mode,
  children,
}: {
  client: ConvexReactClient;
  mode: PublicAuthMode;
  children: ReactNode;
}) {
  if (!mode.authKitClientId) {
    throw new Error("WorkOS is not configured");
  }
  const session = getWorkosSession(mode.authKitClientId);
  const network = useNetworkState();
  const online =
    network.isConnected !== false && network.isInternetReachable !== false;
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const retryDelay = useRef(1000);
  useEffect(() => {
    if (!snapshot.user) {
      retryDelay.current = 1000;
      if (retryPending) {
        setRetryPending(false);
      }
      return;
    }
    if (!(retryPending && online)) {
      return;
    }
    const timer = setTimeout(() => setRetryPending(false), retryDelay.current);
    retryDelay.current = Math.min(retryDelay.current * 2, 60_000);
    return () => clearTimeout(timer);
  }, [retryPending, online, snapshot.user]);
  useEffect(() => {
    let alive = true;
    void session.hydrate().catch(() => {
      if (alive) {
        setHydrationFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [session]);
  useEffect(() => {
    if (!hydrationFailed) {
      return;
    }
    // Keychain can be unavailable while the device is locked. Retain the cache
    // and retry when the app returns to the foreground after unlocking.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void session
          .hydrate()
          .then(() => setHydrationFailed(false))
          .catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [hydrationFailed, session]);
  const value = useMemo(
    () => ({
      mode,
      user: snapshot.user
        ? {
            email: snapshot.user.email,
            name: snapshot.user.name,
            teakUserId: snapshot.user.teakUserId,
          }
        : null,
      isPending: snapshot.isLoading && !hydrationFailed,
      hasStoredSession: snapshot.user !== null || hydrationFailed,
      refreshSession: async () => {
        const token = await session.fetchAccessToken({
          forceRefreshToken: true,
        });
        setHydrationFailed(false);
        return token !== null;
      },
      signIn: (
        provider?: "authkit" | "GoogleOAuth" | "AppleOAuth",
        screenHint?: "sign-in" | "sign-up"
      ) => signInWithWorkos(session, provider, screenHint),
      signOut: async () => {
        // Revoke on the server before clearing secure storage.
        // Keep credentials if the request fails.
        const token = await session.fetchAccessToken();
        if (!token) {
          await session.clear();
          return;
        }
        // Use the real AuthKit sid, never the WorkOS user ID.
        const sessionId = session.getSessionId();
        if (!sessionId) {
          throw new Error("Please sign in again");
        }
        await client.action(api.securitySessions.revokeSession, {
          sessionId,
        });
        await session.clear();
        await openWorkosLogout(sessionId);
      },
    }),
    [mode, snapshot, session, hydrationFailed, client]
  );
  const fetchAccessToken = useCallback(
    async (options: { forceRefreshToken: boolean }) => {
      if (!online || retryPending) {
        return null;
      }
      try {
        const token = await session.fetchAccessToken(options);
        // A cached access token does not prove that the refresh service recovered.
        if (token && options.forceRefreshToken) {
          retryDelay.current = 1000;
        }
        return token;
      } catch {
        // Convex pauses its socket while fetching auth. Always settle with null
        // on a transport outage so public queries and reconnect can continue.
        // Connectivity can stay "online" through DNS, timeout or provider
        // failures. Retry retained credentials without opening another browser.
        if (session.getSnapshot().user) {
          setRetryPending(true);
        }
        return null;
      }
    },
    [session, online, retryPending]
  );
  const useAuth = useMemo(
    () => () => ({
      isLoading: snapshot.isLoading && !hydrationFailed,
      isAuthenticated: snapshot.user !== null,
      fetchAccessToken,
    }),
    [snapshot, fetchAccessToken, hydrationFailed]
  );
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuth}>
      <MobileAuthContext.Provider value={value}>
        {children}
      </MobileAuthContext.Provider>
    </ConvexProviderWithAuth>
  );
}
