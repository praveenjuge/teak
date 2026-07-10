import {
  recordClientOutcome,
  runClientSpan,
} from "@teak/convex/shared/client-telemetry";
import { trackAuth } from "@teak/convex/shared/metrics";
import { useConvexAuth } from "convex/react";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  getAuthRouteState,
  hasStoredBetterAuthSessionCookie,
} from "@/lib/auth-bootstrap";
import { authClient } from "@/lib/auth-client";
import { refreshAuthSessionCache } from "@/lib/auth-session-cache";
import { setMobileSentryUser } from "@/lib/sentry";

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
  const networkState = useNetworkState();
  const { data: session, isPending: isBetterAuthPending } =
    authClient.useSession();
  const hasBetterAuthSession = Boolean(session?.session?.id);
  const [hasAttemptedSessionRefresh, setHasAttemptedSessionRefresh] =
    useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const diagnosticKeyRef = useRef<string | null>(null);
  const bootstrapStartedAtRef = useRef(Date.now());
  const reportedBootstrapRef = useRef(false);

  const hasStoredSessionCookie =
    Platform.OS !== "web" &&
    hasStoredBetterAuthSessionCookie(getStoredAuthCookie());
  const isOnline =
    networkState.isInternetReachable !== false &&
    networkState.isConnected !== false;

  useEffect(() => {
    void setMobileSentryUser(session?.user?.id);
  }, [session?.user?.id]);

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

    trackAuth({ outcome: "attempt", stage: "session_refresh" });
    void runClientSpan(
      {
        name: "mobile.auth.session_refresh",
        operation: "auth",
        stage: "session_refresh",
      },
      refreshAuthSessionCache
    )
      .then(() => {
        trackAuth({ outcome: "success", stage: "session_refresh" });
      })
      .catch((error: unknown) => {
        trackAuth({ outcome: "failure", stage: "session_refresh" });
        recordClientOutcome({
          attributes: {
            "error.class": error instanceof Error ? error.name : "UnknownError",
          },
          category: "mobile.auth",
          message: "mobile.auth.session_refresh.failed",
          outcome: "failure",
        });
      })
      .finally(() => {
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
    isOnline,
  });

  useEffect(() => {
    if (routeState === "loading" || reportedBootstrapRef.current) {
      return;
    }
    reportedBootstrapRef.current = true;
    trackAuth({
      durationMs: Date.now() - bootstrapStartedAtRef.current,
      outcome: routeState === "authenticated" ? "success" : "failure",
      stage: "bootstrap",
    });
  }, [routeState]);

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
    hasStoredSessionCookie,
    hasBetterAuthSession,
    isBetterAuthPending,
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
