import { useConvexAuth } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  getAuthRouteState,
  hasStoredBetterAuthSessionCookie,
} from "@/lib/auth-bootstrap";
import { authClient } from "@/lib/auth-client";
import { refreshAuthSessionCache } from "@/lib/auth-session-cache";

type AuthClientWithCookie = typeof authClient & {
  getCookie?: () => string;
};

function getStoredAuthCookie() {
  try {
    return (authClient as AuthClientWithCookie).getCookie?.() ?? null;
  } catch {
    return null;
  }
}

export function useAuthBootstrap() {
  const { isLoading: isConvexLoading, isAuthenticated: isConvexAuthenticated } =
    useConvexAuth();
  const { data: session, isPending: isBetterAuthPending } =
    authClient.useSession();
  const hasBetterAuthSession = Boolean(session?.session?.id);
  const [hasAttemptedSessionRefresh, setHasAttemptedSessionRefresh] =
    useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const diagnosticKeyRef = useRef<string | null>(null);

  const hasStoredSessionCookie =
    Platform.OS !== "web" &&
    hasStoredBetterAuthSessionCookie(getStoredAuthCookie());

  useEffect(() => {
    if (
      !hasStoredSessionCookie ||
      hasBetterAuthSession ||
      hasAttemptedSessionRefresh ||
      isRefreshingSession
    ) {
      return;
    }

    let isMounted = true;
    setIsRefreshingSession(true);

    refreshAuthSessionCache().finally(() => {
      if (!isMounted) {
        return;
      }
      setHasAttemptedSessionRefresh(true);
      setIsRefreshingSession(false);
    });

    return () => {
      isMounted = false;
    };
  }, [
    hasStoredSessionCookie,
    hasBetterAuthSession,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
  ]);

  const routeState = getAuthRouteState({
    hasStoredSessionCookie,
    hasBetterAuthSession,
    isBetterAuthPending,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    isConvexLoading,
    isConvexAuthenticated,
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    const diagnostics = {
      routeState,
      hasStoredSessionCookie,
      hasBetterAuthSession,
      isBetterAuthPending,
      hasAttemptedSessionRefresh,
      isRefreshingSession,
      isConvexLoading,
      isConvexAuthenticated,
    };
    const key = JSON.stringify(diagnostics);
    if (diagnosticKeyRef.current === key) {
      return;
    }
    diagnosticKeyRef.current = key;
    console.info("[auth] Bootstrap state", diagnostics);
  }, [
    routeState,
    hasStoredSessionCookie,
    hasBetterAuthSession,
    isBetterAuthPending,
    hasAttemptedSessionRefresh,
    isRefreshingSession,
    isConvexLoading,
    isConvexAuthenticated,
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
