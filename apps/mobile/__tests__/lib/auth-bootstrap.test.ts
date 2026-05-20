import { describe, expect, test } from "bun:test";
import {
  getAuthRouteState,
  hasStoredBetterAuthSessionCookie,
} from "../../lib/auth-bootstrap";

describe("auth bootstrap", () => {
  test("detects stored Better Auth session cookies without exposing values", () => {
    expect(
      hasStoredBetterAuthSessionCookie(
        "better-auth.session_token=secret; other=value"
      )
    ).toBe(true);
    expect(
      hasStoredBetterAuthSessionCookie(
        "__Secure-better-auth.session_token=secret"
      )
    ).toBe(true);
    expect(hasStoredBetterAuthSessionCookie("other=value")).toBe(false);
    expect(hasStoredBetterAuthSessionCookie(null)).toBe(false);
  });

  test("keeps loading when a stored cookie exists before session resolves", () => {
    expect(
      getAuthRouteState({
        hasStoredSessionCookie: true,
        hasBetterAuthSession: false,
        isBetterAuthPending: false,
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("loading");
  });

  test("allows auth routes when no cookie or session exists", () => {
    expect(
      getAuthRouteState({
        hasStoredSessionCookie: false,
        hasBetterAuthSession: false,
        isBetterAuthPending: false,
        hasAttemptedSessionRefresh: false,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: true,
      })
    ).toBe("unauthenticated");
  });

  test("keeps loading while Convex warms up after Better Auth resolves", () => {
    expect(
      getAuthRouteState({
        hasStoredSessionCookie: true,
        hasBetterAuthSession: true,
        isBetterAuthPending: false,
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
        hasStoredSessionCookie: true,
        hasBetterAuthSession: true,
        isBetterAuthPending: false,
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
        hasStoredSessionCookie: false,
        hasBetterAuthSession: false,
        isBetterAuthPending: false,
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
        hasStoredSessionCookie: false,
        hasBetterAuthSession: false,
        isBetterAuthPending: false,
        hasAttemptedSessionRefresh: true,
        isRefreshingSession: false,
        isConvexLoading: false,
        isConvexAuthenticated: false,
        isOnline: false,
      })
    ).toBe("offline");
  });
});
