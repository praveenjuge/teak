export type AuthRouteState =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "offline";

export interface AuthBootstrapInput {
  hasAttemptedSessionRefresh: boolean;
  hasBetterAuthSession: boolean;
  hasStoredSessionCookie: boolean;
  isBetterAuthPending: boolean;
  isConvexAuthenticated: boolean;
  isConvexLoading: boolean;
  isOnline: boolean;
  isRefreshingSession: boolean;
}

export function hasStoredBetterAuthSessionCookie(cookie: string | null) {
  return Boolean(
    cookie?.split(";").some((part) => part.includes("session_token="))
  );
}

export function getAuthRouteState({
  hasStoredSessionCookie,
  hasBetterAuthSession,
  isBetterAuthPending,
  hasAttemptedSessionRefresh,
  isRefreshingSession,
  isConvexLoading,
  isConvexAuthenticated,
  isOnline,
}: AuthBootstrapInput): AuthRouteState {
  if (
    hasStoredSessionCookie &&
    !hasBetterAuthSession &&
    (isBetterAuthPending || isRefreshingSession || !hasAttemptedSessionRefresh)
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
