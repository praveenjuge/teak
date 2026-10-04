import {
  recordClientOutcome,
  runClientSpan,
} from "@teak/convex/shared/client-telemetry";
import { trackAuth } from "@teak/convex/shared/metrics";
import { useConvexAuth } from "convex/react";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthRouteState } from "@/lib/auth-bootstrap";
import { useMobileAuth } from "@/lib/mobile-auth-context";
import { setMobileSentryUser } from "@/lib/sentry";

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
  const bootstrapStartedAtRef = useRef(Date.now());
  const reportedBootstrapRef = useRef(false);
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
    void setMobileSentryUser(user?.teakUserId);
  }, [user?.teakUserId]);

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

    trackAuth({ outcome: "attempt", stage: "session_refresh" });
    void runClientSpan(
      {
        name: "mobile.auth.session_refresh",
        operation: "auth",
        stage: "session_refresh",
      },
      refreshSession
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
