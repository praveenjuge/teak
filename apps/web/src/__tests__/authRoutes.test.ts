import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { sealData } from "iron-session";
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
const { serveRoute } = await import("./helpers/serveRoute");
const callback = serveRoute(await import("../app/callback/route"), "/callback");

const offline = ((input: RequestInfo | URL) => {
  throw new Error(`Must not reach ${String(input)}`);
}) as typeof fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
  test("clears a signed-in hint the session no longer backs", async () => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest("http://localhost:3142/", {
        headers: { cookie: "teak_session_hint=1" },
      })
    );
    expect(response.status).toBe(307);
    const hint = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("teak_session_hint="));
    expect(hint).toStartWith("teak_session_hint=;");
    expect(hint).toContain("Max-Age=0");
  });
  test.each([
    ["/login?next=%2Fsettings", "/sign-in?next=%2Fsettings"],
    ["/login?next=https%3A%2F%2Fevil.example", "/sign-in"],
    ["/login?error=sign_in_restart", "/sign-in"],
    ["/register", "/sign-up"],
  ])("sends entry page %s straight to %s", async (path, target) => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest(`http://localhost:3142${path}`)
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3142${target}`
    );
  });
  test.each(["/sign-in", "/sign-up", "/opengraph-image", "/share"])(
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
  test.each([
    ["/ingest/e/?ip=0", "https://us.i.posthog.com/e/?ip=0"],
    [
      "/ingest/static/recorder.js?v=1",
      "https://us-assets.i.posthog.com/static/recorder.js?v=1",
    ],
    [
      "/ingest/array/phc_x/config",
      "https://us-assets.i.posthog.com/array/phc_x/config",
    ],
  ])(
    "proxies %s to PostHog without the session cookie",
    async (path, target) => {
      globalThis.fetch = offline;
      const response = await proxy(
        new NextRequest(`http://localhost:3142${path}`, {
          headers: { cookie: "wos-session=secret", "user-agent": "test" },
        })
      );
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBe(target);
      const forwarded = response.headers
        .get("x-middleware-override-headers")
        ?.split(",");
      expect(forwarded).toContain("user-agent");
      expect(forwarded).not.toContain("cookie");
    }
  );
  test.each([
    "/ingest//evil.example/steal",
    "/ingest//16909060/x",
    "/ingest/%5Cevil.example/x",
  ])("keeps %s on PostHog's host", async (path) => {
    globalThis.fetch = offline;
    const response = await proxy(
      new NextRequest(`http://localhost:3142${path}`)
    );
    const rewrite = response.headers.get("x-middleware-rewrite");
    expect(rewrite && new URL(rewrite).origin).toBe("https://us.i.posthog.com");
  });
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
    const response = await callback("https://evil.example/callback?code=old");
    expect(response.status).toBe(400);
  });
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
          `http://localhost:3142/callback${query}`,
          cookie ? { cookie } : {}
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

const base64url = (bytes: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(
    typeof bytes === "string" ? bytes : new Uint8Array(bytes)
  ).toString("base64url");
// One key for the file: the SDK caches the JWKS it first fetches.
const signingKey = crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"]
);
async function signedInSession() {
  const { privateKey, publicKey } = await signingKey;
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test" }));
  const payload = base64url(
    JSON.stringify({
      sid: "session_test",
      sub: "user_test",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const accessToken = `${header}.${payload}.${base64url(signature)}`;
  const cookie = await sealData(
    {
      accessToken,
      refreshToken: "refresh_test",
      user: { id: "user_test", email: "test@example.org", object: "user" },
    },
    { password: process.env.WORKOS_COOKIE_PASSWORD as string }
  );
  const jwks = ((input: RequestInfo | URL) => {
    if (String(input).includes("/jwks/")) {
      return Promise.resolve(
        Response.json({
          keys: [{ ...jwk, alg: "RS256", kid: "test", use: "sig" }],
        })
      );
    }
    throw new Error(`Must not reach ${String(input)}`);
  }) as typeof fetch;
  return { accessToken, cookie: `wos-session=${cookie}`, jwks };
}

describe("signed-in page loads", () => {
  test("hand the browser its access token in a short-lived cookie", async () => {
    const session = await signedInSession();
    globalThis.fetch = session.jwks;
    const response = await proxy(
      new NextRequest("http://localhost:3142/", {
        headers: { accept: "text/html", cookie: session.cookie },
      })
    );
    expect(response.headers.get("location")).toBeNull();
    const tokenCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("workos-access-token="));
    expect(tokenCookie).toStartWith(
      `workos-access-token=${session.accessToken};`
    );
    expect(tokenCookie).toContain("Max-Age=30");
  });
  test.each([
    ["/sign-in?next=%2Fsettings", "http://localhost:3142/settings"],
    ["/sign-up", "http://localhost:3142/"],
  ])("send a signed-in visit to %s straight to %s", async (path, target) => {
    const session = await signedInSession();
    globalThis.fetch = session.jwks;
    const response = await proxy(
      new NextRequest(`http://localhost:3142${path}`, {
        headers: { accept: "text/html", cookie: session.cookie },
      })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(target);
  });
  test.each(["/sign-in?renew=1&next=%2Fsettings", "/sign-in?reauth=1"])(
    "let a signed-in visit to %s start AuthKit",
    async (path) => {
      const session = await signedInSession();
      globalThis.fetch = session.jwks;
      const response = await proxy(
        new NextRequest(`http://localhost:3142${path}`, {
          headers: { accept: "text/html", cookie: session.cookie },
        })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  );
  test("tell teakvault.com the browser is signed in, once", async () => {
    const session = await signedInSession();
    globalThis.fetch = session.jwks;
    const hint = (cookie: string) =>
      proxy(
        new NextRequest("http://localhost:3142/", {
          headers: { accept: "text/html", cookie },
        })
      ).then((response) =>
        response.headers
          .getSetCookie()
          .find((value) => value.startsWith("teak_session_hint="))
      );
    expect(await hint(session.cookie)).toStartWith("teak_session_hint=1;");
    expect(
      await hint(`${session.cookie}; teak_session_hint=1`)
    ).toBeUndefined();
  });
  test("leave in-app navigations without it", async () => {
    const session = await signedInSession();
    globalThis.fetch = session.jwks;
    const response = await proxy(
      new NextRequest("http://localhost:3142/favorites", {
        headers: { accept: "*/*", cookie: session.cookie, rsc: "1" },
      })
    );
    expect(response.headers.get("location")).toBeNull();
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("workos-access-token="))
    ).toBe(false);
  });
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
