import { describe, expect, test } from "bun:test";
import { getAuthRouteState } from "../../lib/auth-bootstrap";

describe("auth bootstrap", () => {
  test("keeps loading when a stored session exists before it resolves", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: true,
        hasSession: false,
        isSessionPending: false,
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("loading");
  });

  test("allows auth routes when no stored session exists", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: false,
        hasSession: false,
        isSessionPending: false,
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("unauthenticated");
  });

  test("keeps loading while Convex warms up after the session resolves", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: true,
        hasSession: true,
        isSessionPending: false,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
        isConvexLoading: true,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("loading");
  });

  test("allows protected routes after Convex authenticates", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: true,
        hasSession: true,
        isSessionPending: false,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: true,
        isOnline: true,
      })
    ).toBe("authenticated");
  });

  test("allows welcome after explicit sign-out clears session state", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: false,
        hasSession: false,
        isSessionPending: false,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("unauthenticated");
  });

  test("shows offline when the device has no internet", () => {
    expect(
      getAuthRouteState({
        hasStoredSession: false,
        hasSession: false,
        isSessionPending: false,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: false,
      })
    ).toBe("offline");
  });
});
