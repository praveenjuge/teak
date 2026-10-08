import { describe, expect, test } from "bun:test";
import { unsealData } from "iron-session";
import {
  describeWorkosError,
  sealSessionCookie,
  testSessionEmail,
} from "./lib/workos-test-session.ts";
import { parseSmokeCredentials, redirectsTo } from "./smoke-web-session.ts";

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

  test("credential mode defaults to present and rejects unknown values", () => {
    expect(parseSmokeCredentials(undefined)).toBe("present");
    expect(parseSmokeCredentials("fork")).toBe("fork");
    expect(() => parseSmokeCredentials("yes")).toThrow(
      "SMOKE_WORKOS_CREDENTIALS"
    );
  });
});

describe("workos-test-session", () => {
  test("throwaway addresses use the backend's e2e shape on a reserved domain", () => {
    expect(testSessionEmail("smoke")).toMatch(
      /^e2e-smoke-\d+-[0-9a-f]{8}@example\.com$/
    );
  });

  test("the session cookie unseals the way authkit-nextjs reads it", async () => {
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
      await unsealData(cookie.value, { password: cookiePassword })
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
