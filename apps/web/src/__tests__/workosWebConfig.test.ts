import { describe, expect, test } from "bun:test";
import {
  assertWorkosCallbackBinding,
  sameAuthProvider,
  validateAuthMode,
} from "@/lib/auth-mode";
import { readWorkosWebConfig } from "@/lib/workos-config";

const mode = {
  primary: "workos",
  authKitClientId: "client_web123",
  signupsDisabled: false,
  accountChangesPaused: false,
} as const;
const environment = {
  WORKOS_CLIENT_ID: mode.authKitClientId,
  WORKOS_API_KEY: "sk_test_fixture",
  WORKOS_COOKIE_PASSWORD: "test-session-password-for-fixtures-only",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3142/callback",
  NODE_ENV: "development",
};

// Failure modes: malformed public authority; mixed deployment credentials;
// missing/weak seal; unsafe callback origin/path; mismatched JWT issuer.
describe("AuthKit web configuration", () => {
  test("accepts callbacks only while sealed primary and client bindings remain active", () => {
    const state = JSON.stringify({
      primary: mode.primary,
      clientId: mode.authKitClientId,
    });
    expect(() =>
      assertWorkosCallbackBinding(state, mode, mode.authKitClientId)
    ).not.toThrow();
    expect(() =>
      assertWorkosCallbackBinding(
        state,
        { ...mode, primary: "betterauth" },
        mode.authKitClientId
      )
    ).toThrow();
    expect(() =>
      assertWorkosCallbackBinding(
        state,
        { ...mode, authKitClientId: "client_other" },
        mode.authKitClientId
      )
    ).toThrow();
    for (const invalid of [
      undefined,
      "not-json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ primary: "betterauth", clientId: mode.authKitClientId }),
      JSON.stringify({ primary: "workos", clientId: "client_other" }),
    ]) {
      expect(() =>
        assertWorkosCallbackBinding(invalid, mode, mode.authKitClientId)
      ).toThrow();
    }
  });
  test("keeps local callback transport and registered client bound", () => {
    expect(readWorkosWebConfig(mode, environment)).toEqual({
      clientId: mode.authKitClientId,
      origin: "http://localhost:3142",
      redirectUri: environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
    });
    expect(
      readWorkosWebConfig(mode, {
        ...environment,
        NODE_ENV: "production",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://app.teakvault.com/callback",
      }).origin
    ).toBe("https://app.teakvault.com");
  });
  test.each([
    "WORKOS_CLIENT_ID",
    "WORKOS_API_KEY",
    "WORKOS_COOKIE_PASSWORD",
    "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  ])("denies absent %s without legacy fallback", (key) => {
    expect(() =>
      readWorkosWebConfig(mode, { ...environment, [key]: undefined })
    ).toThrow();
  });
  test.each([
    "http://evil.example/callback",
    "https://app.teakvault.com/other",
    "https://evil.example/callback?next=/",
    "https://name:password@app.teakvault.com/callback",
    "https://app.teakvault.com/callback#token",
  ])("denies unsafe callback %s", (url) => {
    expect(() =>
      readWorkosWebConfig(mode, {
        ...environment,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: url,
      })
    ).toThrow();
  });
  test("denies mixed client IDs and session issuers", () => {
    expect(() =>
      readWorkosWebConfig(mode, {
        ...environment,
        WORKOS_CLIENT_ID: "client_other",
      })
    ).toThrow();
    expect(() =>
      readWorkosWebConfig(mode, {
        ...environment,
        WORKOS_ISSUER: "https://api.workos.com/user_management/client_other",
      })
    ).toThrow();
    expect(() =>
      readWorkosWebConfig(mode, {
        ...environment,
        WORKOS_COOKIE_PASSWORD: "short",
      })
    ).toThrow();
    expect(() =>
      readWorkosWebConfig({ ...mode, primary: "betterauth" }, environment)
    ).toThrow();
  });
  test.each([
    null,
    {},
    { ...mode, primary: "unknown" },
    { ...mode, authKitClientId: undefined },
    { ...mode, signupsDisabled: "false" },
    { ...mode, authKitClientId: "client_bad/path" },
  ])("denies invalid public authority %#", (value) => {
    expect(() => validateAuthMode(value)).toThrow();
  });
  test("keeps Better Auth optional credentials and observes provider/client changes", () => {
    const legacy = {
      primary: "betterauth",
      signupsDisabled: false,
      accountChangesPaused: false,
    } as const;
    expect(validateAuthMode(legacy)).toEqual(legacy);
    expect(sameAuthProvider(mode, { ...mode, signupsDisabled: true })).toBe(
      true
    );
    expect(
      sameAuthProvider(mode, { ...mode, authKitClientId: "client_other" })
    ).toBe(false);
    expect(sameAuthProvider(mode, legacy)).toBe(false);
  });
});
