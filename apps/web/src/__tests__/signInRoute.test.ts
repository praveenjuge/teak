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
const originalFetch = globalThis.fetch;
const keys = [
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
const { NextRequest } = await import("next/server");
const { AppRouteRouteModule } = await import(
  "next/dist/server/route-modules/app-route/module.js"
);
const signInRoute = await import("../app/sign-in/route");
const signUpRoute = await import("../app/sign-up/route");
const { assertWorkosCallbackBinding } = await import("@/lib/workos-config");

// Serves the route the way Next does, so `cookies()` writes reach the response.
// Needs Next's AsyncLocalStorage global, preloaded by the `test` script.
function serveRoute(userland: unknown, pathname: string) {
  const module = new AppRouteRouteModule({
    userland: () => userland,
    definition: {
      kind: "APP_ROUTE",
      page: `${pathname}/route`,
      pathname,
      filename: "route",
      bundlePath: `app${pathname}/route`,
    },
    distDir: ".next",
    relativeProjectDir: "",
    resolvedPagePath: "",
    nextConfigOutput: undefined,
  } as never);
  return (url: string) =>
    module.handle(new NextRequest(url), {
      renderOpts: { experimental: {}, supportsDynamicResponse: true },
      sharedContext: { buildId: "test" },
    } as never);
}
const signIn = serveRoute(signInRoute, "/sign-in");
const signUp = serveRoute(signUpRoute, "/sign-up");

// Starting sign-in is local: any upstream request fails the test.
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

// Failure modes: an email-originated sign-in the callback cannot redeem (no
// PKCE cookie, or state not bound to it or to this client), open redirects
// through `next`, and starting WorkOS sign-in for another origin.
describe("WorkOS Initiate login URI", () => {
  test.each([
    ["/settings?tab=account", "/settings?tab=account"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/login", "/"],
    ["/sign-in", "/"],
  ])("starts a bound AuthKit sign-in (next=%s)", async (next, returnTo) => {
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

    // The callback requires the cookie value to equal the returned state.
    const state = authorize.searchParams.get("state");
    const [cookie] = pkceCookies(response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=600");
    const pair = cookie?.split(";")[0] ?? "";
    expect(pair.slice(pair.indexOf("=") + 1)).toBe(state ?? "");

    const sealed = await unsealData<{
      codeVerifier: string;
      customState: string;
      returnPathname: string;
    }>(state ?? "", { password: cookiePassword });
    expect(await s256(sealed.codeVerifier)).toBe(
      authorize.searchParams.get("code_challenge") ?? ""
    );
    expect(sealed.returnPathname).toBe(returnTo);
    expect(() =>
      assertWorkosCallbackBinding(sealed.customState, "client_web123")
    ).not.toThrow();
    expect(() =>
      assertWorkosCallbackBinding(sealed.customState, "client_other")
    ).toThrow("Sign-in changed. Please start again.");
  });
  test("denies sign-in outside the configured callback origin", async () => {
    const response = await signIn("https://evil.example/sign-in");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(pkceCookies(response)).toEqual([]);
  });
});

describe("WorkOS sign-up route", () => {
  test("starts AuthKit on the sign-up screen", async () => {
    const response = await signUp(
      "http://localhost:3142/sign-up?next=%2Fsettings"
    );
    expect(response.status).toBe(303);
    const authorize = new URL(response.headers.get("location") ?? "");
    expect(authorize.searchParams.get("screen_hint")).toBe("sign-up");
    expect(authorize.searchParams.get("client_id")).toBe("client_web123");
    expect(pkceCookies(response)).toHaveLength(1);
  });
});

// A failed callback returns here with `reauth`. Forcing fresh credentials
// stops an existing AuthKit session from bouncing straight back into it.
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
