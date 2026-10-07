import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { NextRequest } from "next/server";
import { legacyMode, withAuthModeFetch } from "./authModeNetworkFixture";

mock.module("server-only", () => ({}));
const originalFetch = globalThis.fetch;
const keys = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "NODE_ENV",
];
const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://example.convex.site";
process.env.WORKOS_CLIENT_ID = "client_web123";
process.env.WORKOS_API_KEY = "sk_test_fixture";
process.env.WORKOS_COOKIE_PASSWORD = "test-session-password-for-fixtures-only";
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
const { default: proxy } = await import("../proxy");
const { GET: callback } = await import("../app/callback/route");
const { proxyAuthorizationServerMetadata } = await import(
  "@/lib/oauth-metadata-proxy"
);
const { mcpUserInfo } = await import("@/lib/mcp-oauth-endpoints");
const { GET: legacyGet, POST: legacyPost } = await import(
  "../app/api/auth/[...all]/route"
);
const { readProxyAuthMode } = await import("@/lib/auth-mode-server");
const workosMode = {
  ...legacyMode,
  primary: "workos",
  authKitClientId: "client_web123",
} as const;

beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = `https://case${crypto.randomUUID().replaceAll("-", "")}.convex.cloud`;
  globalThis.fetch = withAuthModeFetch(originalFetch);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Failure modes: stale legacy cookie; provider cutover behind the routing cache;
// inactive callback/metadata/token routes; forged SDK headers; request origin;
// malformed authority and unavailable authority. No auth implementation is mocked.
describe("web provider routing", () => {
  test("expires optimistic mode routing within 30 seconds", async () => {
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      expect((await readProxyAuthMode()).primary).toBe("betterauth");
      globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
      now += 29_999;
      expect((await readProxyAuthMode()).primary).toBe("betterauth");
      now += 2;
      expect((await readProxyAuthMode()).primary).toBe("workos");
    } finally {
      clock.mockRestore();
    }
  });
  test("blocks legacy credentials and account change requests using fresh server authority", async () => {
    globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
    const oldSession = new Request(
      "http://localhost:3142/api/auth/get-session",
      { headers: { cookie: "better-auth.session_token=expired" } }
    );
    expect((await legacyGet(oldSession)).status).toBe(409);
    globalThis.fetch = withAuthModeFetch(originalFetch, {
      ...legacyMode,
      accountChangesPaused: true,
    });
    for (const action of [
      "change-email",
      "change-password",
      "set-password",
      "delete-user",
      "request-password-reset",
      "reset-password",
    ]) {
      const response = await legacyPost(
        new Request(`http://localhost:3142/api/auth/${action}`, {
          method: "POST",
        })
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error).toBe("account_changes_paused");
    }
  });
  test("keeps stale-cookie auth pages and public infrastructure reachable", async () => {
    for (const path of [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/sign-in",
      "/monitoring",
      "/opengraph-image",
    ]) {
      const response = await proxy(
        new NextRequest(`http://localhost:3142${path}`, {
          headers: { cookie: "better-auth.session_token=expired" },
        })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });
  test("strips forged AuthKit session headers in Better Auth mode", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3142/login", {
        headers: {
          "x-workos-session": "forged",
          "x-workos-middleware": "true",
          "x-redirect-uri": "https://evil.example/callback",
          "x-url": "https://evil.example/",
        },
      })
    );
    expect(
      response.headers.get("x-middleware-request-x-workos-session")
    ).toBeNull();
    expect(
      response.headers.get("x-middleware-request-x-redirect-uri")
    ).toBeNull();
    expect(response.headers.get("x-middleware-request-x-url")).toBeNull();
  });
  test("routes WorkOS protected pages through the configured local sign-in origin", async () => {
    globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
    const response = await proxy(
      new NextRequest("http://localhost:3142/settings?tab=account")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3142/login?next=%2Fsettings%3Ftab%3Daccount"
    );
    expect(response.headers.get("x-workos-session")).toBeNull();
  });
  test("lets signed-out WorkOS email returns reach the sign-in route", async () => {
    globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
    const response = await proxy(
      new NextRequest("http://localhost:3142/sign-in")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
  test("fresh auth entry observes a cutover even when the proxy cached Better Auth", async () => {
    await proxy(new NextRequest("http://localhost:3142/login"));
    globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
    const response = await proxy(new NextRequest("https://evil.example/login"));
    expect(response.status).toBe(400);
  });
  test("denies WorkOS callbacks while Better Auth is selected", async () => {
    const response = await callback(
      new NextRequest("http://localhost:3142/callback?code=old")
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  test("denies callback origins outside configured WorkOS deployment", async () => {
    globalThis.fetch = withAuthModeFetch(originalFetch, workosMode);
    expect(
      (
        await callback(
          new NextRequest("https://evil.example/callback?code=old")
        )
      ).status
    ).toBe(400);
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
      const unexpected = ((input: RequestInfo | URL) => {
        reached.push(String(input));
        throw new Error(`Callback must not reach ${String(input)}`);
      }) as typeof fetch;
      globalThis.fetch = withAuthModeFetch(unexpected, workosMode);
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
          "http://localhost:3142/login?error=sign_in_restart"
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
  test("never returns legacy issuer metadata or userinfo in WorkOS mode", async () => {
    const unexpected = (() => {
      throw new Error("Legacy upstream must not be reached");
    }) as typeof fetch;
    globalThis.fetch = withAuthModeFetch(unexpected, workosMode);
    expect((await proxyAuthorizationServerMetadata()).status).toBe(409);
    expect(
      (
        await mcpUserInfo(
          new Request("http://localhost:3142/api/auth/mcp/userinfo", {
            headers: { authorization: "Bearer oldtoken" },
          })
        )
      ).status
    ).toBe(409);
  });
  test("fails closed on unavailable or invalid authority", async () => {
    for (const value of [undefined, { ...legacyMode, primary: "unknown" }]) {
      globalThis.fetch = (async () =>
        value
          ? Response.json({ status: "success", value })
          : Promise.reject(new Error("offline"))) as typeof fetch;
      const response = await proxy(
        new NextRequest("http://localhost:3142/login")
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

// SDK env values are captured at import. Restore after this module's tests.
import { afterAll } from "bun:test";

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
