import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { unsealData } from "iron-session";

mock.module("server-only", () => ({}));
// `cacheLife` only works inside a compiled "use cache" scope, which Bun
// doesn't compile, so the sign-up check runs uncached here.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, cacheLife: () => undefined }));
const originalFetch = globalThis.fetch;
const keys = [
  "NEXT_PUBLIC_CONVEX_URL",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "NODE_ENV",
];
const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
const cookiePassword = "test-session-password-for-fixtures-only";
process.env.WORKOS_CLIENT_ID = "client_web123";
process.env.WORKOS_API_KEY = "sk_test_fixture";
process.env.WORKOS_COOKIE_PASSWORD = cookiePassword;
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://sign-up-tests.convex.cloud";
const { serveRoute } = await import("./helpers/serveRoute");
const signInRoute = await import("../app/sign-in/route");
const signUpRoute = await import("../app/sign-up/route");

const signIn = serveRoute(signInRoute, "/sign-in");
const signUp = serveRoute(signUpRoute, "/sign-up");

const offline = ((input: RequestInfo | URL) => {
  throw new Error(`Sign-in must not reach ${String(input)}`);
}) as typeof fetch;

function pkceCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((value) => value.startsWith("wos-auth-verifier-"));
}

async function s256(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return Buffer.from(digest).toString("base64url");
}

beforeEach(() => {
  globalThis.fetch = offline;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WorkOS Initiate login URI", () => {
  test.each([
    ["/settings?tab=account", "/settings?tab=account"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/login", "/"],
    ["/sign-in", "/"],
  ])(
    "starts an AuthKit sign-in with PKCE (next=%s)",
    async (next, returnTo) => {
      const response = await signIn(
        `http://localhost:3142/sign-in?next=${encodeURIComponent(next)}`
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const authorize = new URL(response.headers.get("location") ?? "");
      expect(`${authorize.origin}${authorize.pathname}`).toBe(
        "https://api.workos.com/user_management/authorize"
      );
      expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
        client_id: "client_web123",
        provider: "authkit",
        redirect_uri: "http://localhost:3142/callback",
        response_type: "code",
        screen_hint: "sign-in",
        code_challenge_method: "S256",
      });

      const state = authorize.searchParams.get("state");
      const [cookie] = pkceCookies(response);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Max-Age=600");
      const pair = cookie?.split(";")[0] ?? "";
      expect(pair.slice(pair.indexOf("=") + 1)).toBe(state ?? "");

      const sealed = await unsealData<{
        codeVerifier: string;
        returnPathname: string;
      }>(state ?? "", { password: cookiePassword });
      expect(await s256(sealed.codeVerifier)).toBe(
        authorize.searchParams.get("code_challenge") ?? ""
      );
      expect(sealed.returnPathname).toBe(returnTo);
    }
  );
  test.each([
    ["sign-in", () => signIn],
    ["sign-up", () => signUp],
  ])(
    "answers a router fetch to %s without starting AuthKit",
    async (screen, route) => {
      const response = await route()(
        `http://localhost:3142/${screen}?next=%2F`,
        { rsc: "1", "next-router-prefetch": "1" }
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("location")).toBeNull();
      expect(pkceCookies(response)).toEqual([]);
    }
  );
  test("denies sign-in outside the configured callback origin", async () => {
    const response = await signIn("https://evil.example/sign-in");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(pkceCookies(response)).toEqual([]);
  });
});

const authMode = (signupsDisabled: boolean) =>
  ((input: RequestInfo | URL) =>
    String(input) === "https://sign-up-tests.convex.cloud/api/query"
      ? Promise.resolve(
          Response.json({
            status: "success",
            value: {
              primary: "workos",
              signupsDisabled,
              accountChangesPaused: false,
            },
            logLines: [],
          })
        )
      : offline(input)) as typeof fetch;

describe("WorkOS sign-up route", () => {
  test("starts AuthKit on the sign-up screen", async () => {
    globalThis.fetch = authMode(false);
    const response = await signUp(
      "http://localhost:3142/sign-up?next=%2Fsettings"
    );
    expect(response.status).toBe(303);
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.searchParams.get("screen_hint")).toBe("sign-up");
    expect(authorize.searchParams.get("client_id")).toBe("client_web123");
    expect(pkceCookies(response)).toHaveLength(1);
  });
  test.each([
    ["sign-ups are paused", authMode(true)],
    ["the pause flag can't be read", offline],
  ])("opens the sign-in screen when %s", async (_name, fetchImpl) => {
    globalThis.fetch = fetchImpl;
    const response = await signUp("http://localhost:3142/sign-up");
    expect(response.status).toBe(303);
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.searchParams.get("screen_hint")).toBe("sign-in");
  });
});

describe("sign-in after a failed callback", () => {
  test("asks for credentials again", async () => {
    const response = await signIn("http://localhost:3142/sign-in?reauth=1");
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.searchParams.get("max_age")).toBe("0");
  });
  test("ordinary sign-ins reuse the AuthKit session", async () => {
    const response = await signIn("http://localhost:3142/sign-in");
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.searchParams.has("max_age")).toBe(false);
  });
});

afterAll(() => {
  for (const key of keys) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
