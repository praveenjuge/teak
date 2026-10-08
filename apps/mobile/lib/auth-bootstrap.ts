export type AuthRouteState =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "offline";

export interface AuthBootstrapInput {
  hasAttemptedSessionRefresh: boolean;
  hasSession: boolean;
  hasStoredSession: boolean;
  isConvexAuthenticated: boolean;
  isConvexLoading: boolean;
  isOnline: boolean;
  isRefreshingSession: boolean;
  isSessionPending: boolean;
}

export function getAuthRouteState({
  hasStoredSession,
  hasSession,
  isSessionPending,
  hasAttemptedSessionRefresh,
  isRefreshingSession,
  isConvexLoading,
  isConvexAuthenticated,
  isOnline,
}: AuthBootstrapInput): AuthRouteState {
  if (
    hasStoredSession &&
    !hasSession &&
    (isSessionPending || isRefreshingSession || !hasAttemptedSessionRefresh)
  ) {
    return "loading";
  }

  if (!isOnline) {
    return "offline";
  }

  if (isConvexLoading) {
    return "loading";
  }

  return isConvexAuthenticated ? "authenticated" : "unauthenticated";
}
