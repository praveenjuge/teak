import { describe, expect, test } from "bun:test";
import {
  assertWorkosCallbackBinding,
  readWorkosWebConfig,
  workosCallbackState,
} from "@/lib/workos-config";

const clientId = "client_web123";
const environment = {
  WORKOS_CLIENT_ID: clientId,
  WORKOS_API_KEY: "sk_test_fixture",
  WORKOS_COOKIE_PASSWORD: "test-session-password-for-fixtures-only",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3142/callback",
  NODE_ENV: "development",
};

// Failure modes: callbacks for another client; missing/weak seal; malformed
// client IDs; unsafe callback origin/path; mismatched JWT issuer.
describe("AuthKit web configuration", () => {
  test("accepts callbacks only for sign-ins started with this client", () => {
    const state = workosCallbackState(clientId);
    expect(() => assertWorkosCallbackBinding(state, clientId)).not.toThrow();
    // Sign-ins started before the provider switch was removed still complete.
    expect(() =>
      assertWorkosCallbackBinding(
        JSON.stringify({ primary: "workos", clientId }),
        clientId
      )
    ).not.toThrow();
    for (const invalid of [
      undefined,
      "not-json",
      "null",
      "[]",
      "{}",
      workosCallbackState("client_other"),
    ]) {
      expect(() => assertWorkosCallbackBinding(invalid, clientId)).toThrow(
        "Sign-in changed. Please start again."
      );
    }
  });
  test("reports malformed callback configuration consistently", () => {
    expect(() =>
      readWorkosWebConfig({
        ...environment,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: "not-a-url",
      })
    ).toThrow("Invalid sign-in callback configuration.");
  });
  test("keeps local callback transport and registered client bound", () => {
    expect(readWorkosWebConfig(environment)).toEqual({
      clientId,
      origin: "http://localhost:3142",
      redirectUri: environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
    });
    expect(
      readWorkosWebConfig({
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
  ])("denies absent %s", (key) => {
    expect(() =>
      readWorkosWebConfig({ ...environment, [key]: undefined })
    ).toThrow("Sign-in is not configured for this environment.");
  });
  test.each([
    "http://evil.example/callback",
    "https://app.teakvault.com/other",
    "https://evil.example/callback?next=/",
    "https://name:password@app.teakvault.com/callback",
    "https://app.teakvault.com/callback#token",
  ])("denies unsafe callback %s", (url) => {
    expect(() =>
      readWorkosWebConfig({
        ...environment,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: url,
      })
    ).toThrow("Invalid sign-in callback configuration.");
  });
  test.each([
    ["a malformed client ID", { WORKOS_CLIENT_ID: "client_bad/path" }],
    ["a weak cookie password", { WORKOS_COOKIE_PASSWORD: "short" }],
    [
      "another client's session issuer",
      {
        WORKOS_ISSUER: "https://api.workos.com/user_management/client_other",
      },
    ],
  ])("denies %s", (_name, override) => {
    expect(() =>
      readWorkosWebConfig({ ...environment, ...override })
    ).toThrow();
  });
});
