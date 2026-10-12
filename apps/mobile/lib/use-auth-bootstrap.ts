import { useConvexAuth } from "convex/react";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthRouteState } from "@/lib/auth-bootstrap";
import { useMobileAuth } from "@/lib/mobile-auth-context";

export function useAuthBootstrap() {
  const { isLoading: isConvexLoading, isAuthenticated: isConvexAuthenticated } =
    useConvexAuth();
  const networkState = useNetworkState();
  const {
    user,
    isPending: isSessionPending,
    hasStoredSession,
    refreshSession,
  } = useMobileAuth();
  const hasSession = Boolean(user);
  const [hasAttemptedSessionRefresh, setHasAttemptedSessionRefresh] =
    useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const diagnosticKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isOnline =
    networkState.isInternetReachable !== false &&
    networkState.isConnected !== false;

  useEffect(() => {
    if (
      !hasStoredSession ||
      hasSession ||
      hasAttemptedSessionRefresh ||
      isRefreshingSession
    ) {
      return;
    }

    setIsRefreshingSession(true);

    void refreshSession()
      .catch(() => {
        // A failed refresh falls through to the signed-out route state.
      })
      .finally(() => {
        if (!mountedRef.current) {
          return;
        }
        setHasAttemptedSessionRefresh(true);
        setIsRefreshingSession(false);
      });
  }, [
    hasStoredSession,
    hasSession,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    refreshSession,
  ]);

  const routeState = getAuthRouteState({
    hasStoredSession,
    hasSession,
    isSessionPending,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    isConvexLoading,
    isConvexAuthenticated,
    isOnline,
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    const diagnostics = {
      routeState,
      hasStoredSession,
      hasSession,
      isSessionPending,
      hasAttemptedSessionRefresh,
      isRefreshingSession,
      isConvexLoading,
      isConvexAuthenticated,
      isOnline,
    };
    const key = JSON.stringify(diagnostics);
    if (diagnosticKeyRef.current === key) {
      return;
    }
    diagnosticKeyRef.current = key;
    console.info("[auth] Bootstrap state", diagnostics);
  }, [
    routeState,
    hasStoredSession,
    hasSession,
    isSessionPending,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    isConvexLoading,
    isConvexAuthenticated,
    isOnline,
  ]);

  return useMemo(
    () => ({
      routeState,
      isAuthenticated: routeState === "authenticated",
      isLoading: routeState === "loading",
    }),
    [routeState]
  );
}
