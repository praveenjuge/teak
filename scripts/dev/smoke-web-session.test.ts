import { describe, expect, test } from "bun:test";
import { sessionEncryption } from "@workos/authkit-session";
import {
  describeWorkosError,
  sealSessionCookie,
  testSessionEmail,
} from "../lib/workos-test-session.ts";
import {
  redirectsTo,
  startsSignIn,
  workosApiOrigin,
} from "./smoke-web-session.ts";

const base = "http://localhost:3000";

describe("smoke-web-session", () => {
  test.each([
    [307, "/sign-in?next=%2F"],
    [302, "http://localhost:3000/sign-in"],
  ])("accepts a %i redirect to the app's /sign-in", (status, location) => {
    expect(redirectsTo(status, location, base, "/sign-in")).toBe(true);
  });

  test.each([
    ["a 200 page", 200, "/sign-in"],
    ["a redirect without a location", 307, null],
    ["a redirect to another path", 307, "/login"],
    ["a redirect to another origin", 307, "https://evil.example/sign-in"],
  ])("rejects %s as the auth gate", (_label, status, location) => {
    expect(redirectsTo(status, location, base, "/sign-in")).toBe(false);
  });
});

describe("the anonymous auth gate", () => {
  test("accepts a page load sent straight to hosted AuthKit with this app's callback", () => {
    const authorize = `https://api.workos.com/user_management/authorize?client_id=client_1&redirect_uri=${encodeURIComponent(`${base}/callback`)}`;
    expect(startsSignIn(307, authorize, base)).toBe(true);
    expect(startsSignIn(307, "/sign-in?next=%2F", base)).toBe(true);
  });

  test("accepts a base URL with a trailing slash", () => {
    const authorize = `https://api.workos.com/user_management/authorize?redirect_uri=${encodeURIComponent(`${base}/callback`)}`;
    expect(startsSignIn(307, authorize, `${base}/`)).toBe(true);
  });

  test("rejects an authorize endpoint on a host that isn't the WorkOS API", () => {
    const authorize = `https://evil.example/user_management/authorize?redirect_uri=${encodeURIComponent(`${base}/callback`)}`;
    expect(startsSignIn(307, authorize, base)).toBe(false);
  });

  test("accepts the local emulator when the web app's AuthKit calls it", () => {
    const values = new Map([
      ["WORKOS_API_HOSTNAME", "localhost"],
      ["WORKOS_API_PORT", "4100"],
      ["WORKOS_API_HTTPS", "false"],
    ]);
    const origin = workosApiOrigin(values);
    expect(origin).toBe("http://localhost:4100");
    const authorize = `${origin}/user_management/authorize?redirect_uri=${encodeURIComponent(`${base}/callback`)}`;
    expect(startsSignIn(307, authorize, base, origin)).toBe(true);
    expect(startsSignIn(307, authorize, base)).toBe(false);
  });

  test("rejects AuthKit sending the session to another app", () => {
    const authorize = `https://api.workos.com/user_management/authorize?redirect_uri=${encodeURIComponent("https://evil.example/callback")}`;
    expect(startsSignIn(307, authorize, base)).toBe(false);
    expect(startsSignIn(200, null, base)).toBe(false);
  });
});

describe("workos-test-session", () => {
  test("throwaway addresses use the e2e- prefix on a reserved domain", () => {
    expect(testSessionEmail("smoke")).toMatch(
      /^e2e-smoke-\d+-[0-9a-f]{8}@example\.org$/
    );
  });

  test("the session cookie unseals the way AuthKit reads it", async () => {
    const cookiePassword = "fixture-cookie-password-of-32-characters";
    const auth = {
      accessToken: "access-fixture",
      refreshToken: "refresh-fixture",
      user: { id: "user_fixture" },
      impersonator: undefined,
      authenticationMethod: "Password" as const,
    };
    const cookie = await sealSessionCookie(
      auth as unknown as Parameters<typeof sealSessionCookie>[0],
      { cookiePassword, redirectUri: "http://localhost:3000/callback" }
    );
    expect(cookie.name).toBe("wos-session");
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(cookie.value).not.toContain("access-fixture");
    expect(
      await sessionEncryption.unsealData(cookie.value, {
        password: cookiePassword,
      })
    ).toMatchObject({
      accessToken: "access-fixture",
      refreshToken: "refresh-fixture",
      user: { id: "user_fixture" },
    });
    const secure = await sealSessionCookie(
      auth as unknown as Parameters<typeof sealSessionCookie>[0],
      { cookiePassword, redirectUri: "https://app.example/callback" }
    );
    expect(secure.options.secure).toBe(true);
  });

  test("WorkOS errors report name, status and code but never the message", () => {
    const error = Object.assign(
      new Error("password hunter2 for e2e-x@example.com is weak"),
      {
        name: "UnprocessableEntityException",
        status: 422,
        code: "password_strength_error",
      }
    );
    const summary = describeWorkosError(error);
    expect(summary).toBe(
      "UnprocessableEntityException 422 (password_strength_error)"
    );
    expect(summary).not.toContain("hunter2");
  });

  test("codes that are not identifier-shaped are dropped", () => {
    const error = Object.assign(new Error("x"), {
      status: 400,
      code: "user@example.com",
    });
    expect(describeWorkosError(error)).toBe("Error 400");
  });
});
