import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { NextRequest } from "next/server";

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
process.env.WORKOS_CLIENT_ID = "client_web123";
process.env.WORKOS_API_KEY = "sk_test_fixture";
process.env.WORKOS_COOKIE_PASSWORD = "test-session-password-for-fixtures-only";
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
const { default: proxy } = await import("../proxy");
const { GET: callback } = await import("../app/callback/route");

// Signed-out requests and failed callbacks must never reach WorkOS.
const offline = ((input: RequestInfo | URL) => {
  throw new Error(`Must not reach ${String(input)}`);
}) as typeof fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Failure modes: a protected page served without a session, entry pages that
// render instead of handing off to AuthKit, open redirects through `next`,
// forged SDK headers, foreign request origins, missing configuration, and
// callbacks that redeem a code they cannot bind.
describe("web sign-in routing", () => {
  test("sends signed-out visitors to sign-in with their destination", async () => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest("http://localhost:3142/settings?tab=account")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3142/sign-in?next=%2Fsettings%3Ftab%3Daccount"
    );
    expect(response.headers.get("x-workos-session")).toBeNull();
  });
  test.each([
    ["/login?next=%2Fsettings", "/sign-in?next=%2Fsettings"],
    ["/login?next=https%3A%2F%2Fevil.example", "/sign-in"],
    ["/login?error=sign_in_restart", "/sign-in"],
    ["/register", "/sign-up"],
    ["/forgot-password", "/sign-in"],
    ["/reset-password?token=old", "/sign-in"],
  ])("sends entry page %s straight to %s", async (path, target) => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest(`http://localhost:3142${path}`, {
        headers: { cookie: "better-auth.session_token=expired" },
      })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3142${target}`
    );
  });
  test.each(["/sign-in", "/sign-up", "/monitoring", "/opengraph-image"])(
    "lets signed-out visitors reach %s",
    async (path) => {
      globalThis.fetch = offline;
      const response = await proxy(
        new NextRequest(`http://localhost:3142${path}`)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  );
  test("strips forged AuthKit session headers", async () => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest("http://localhost:3142/sign-in", {
        headers: {
          "x-workos-session": "forged",
          "x-workos-middleware": "true",
          "x-redirect-uri": "https://evil.example/callback",
          "x-url": "https://evil.example/",
        },
      })
    );
    // Next forwards only the headers listed here, so the forged session is dropped.
    expect(
      response.headers.get("x-middleware-override-headers")?.split(",")
    ).not.toContain("x-workos-session");
    expect(response.headers.get("x-middleware-request-x-redirect-uri")).toBe(
      "http://localhost:3142/callback"
    );
    expect(response.headers.get("x-middleware-request-x-url")).toBe(
      "http://localhost:3142/sign-in"
    );
  });
  test("denies requests outside the configured sign-in origin", async () => {
    globalThis.fetch = offline;
    const response = await proxy(new NextRequest("https://evil.example/login"));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });
  test("fails closed when sign-in is not configured", async () => {
    globalThis.fetch = offline;
    const password = process.env.WORKOS_COOKIE_PASSWORD;
    process.env.WORKOS_COOKIE_PASSWORD = "short";
    try {
      const response = await proxy(
        new NextRequest("http://localhost:3142/settings")
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      process.env.WORKOS_COOKIE_PASSWORD = password;
    }
  });
  test("denies callback origins outside the configured deployment", async () => {
    globalThis.fetch = offline;
    const response = await callback(
      new NextRequest("https://evil.example/callback?code=old")
    );
    expect(response.status).toBe(400);
  });
  // Production 2026-10-07: a password reset email returned `code` without
  // `state`, and the SDK's cache headers threw on an immutable redirect (500).
  // Node follows the Fetch spec (`Response.redirect` headers are immutable);
  // Bun does not, so the spec guard is restored for this boundary only.
  class ImmutableHeaders extends Headers {
    override append(): never {
      throw new TypeError("immutable");
    }
    override delete(): never {
      throw new TypeError("immutable");
    }
    override set(): never {
      throw new TypeError("immutable");
    }
  }
  const nativeRedirect = Response.redirect.bind(Response);
  test.each([
    ["no state (reset email return)", "?code=reset", undefined],
    ["no PKCE cookie", "?code=reset&state=sealed", undefined],
    [
      "state not bound to the PKCE cookie",
      "?code=reset&state=forged",
      "wos-auth-verifier=other",
    ],
  ])(
    "restarts sign-in without redeeming the code: %s",
    async (_name, query, cookie) => {
      // The SDK catches upstream failures, so record calls instead of
      // relying on a throw: no code exchange may reach WorkOS.
      const reached: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL) => {
        reached.push(String(input));
        throw new Error(`Callback must not reach ${String(input)}`);
      }) as typeof fetch;
      const error = spyOn(console, "error").mockImplementation(() => undefined);
      const redirect = spyOn(Response, "redirect").mockImplementation(
        (url, status) => {
          const response = nativeRedirect(url, status);
          const headers = new ImmutableHeaders(response.headers);
          Object.defineProperty(response, "headers", { value: headers });
          return response;
        }
      );
      try {
        const response = await callback(
          new NextRequest(`http://localhost:3142/callback${query}`, {
            headers: cookie ? { cookie } : {},
          })
        );
        expect(reached).toEqual([]);
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(
          "http://localhost:3142/sign-in?reauth=1"
        );
        expect(response.headers.get("cache-control")).toContain("no-store");
        const setCookies = response.headers.getSetCookie();
        expect(
          setCookies.some((value) => value.startsWith("wos-session="))
        ).toBe(false);
        if (query.includes("state=")) {
          expect(
            setCookies.some(
              (value) =>
                value.startsWith("wos-auth-verifier-") &&
                value.includes("Max-Age=0")
            )
          ).toBe(true);
        }
      } finally {
        redirect.mockRestore();
        error.mockRestore();
      }
    }
  );
});

// SDK env values are captured at import. Restore after this module's tests.
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
