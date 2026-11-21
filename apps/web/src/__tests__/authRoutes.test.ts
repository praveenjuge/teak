import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { workosEntryRedirect } from "@/lib/auth-entry";

const originalFetch = globalThis.fetch;
const keys = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "VITE_PUBLIC_WORKOS_REDIRECT_URI",
  "NODE_ENV",
];
const originalEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
process.env.WORKOS_CLIENT_ID = "client_web123";
// The web app signs in as a public client, without an API key.
Reflect.deleteProperty(process.env, "WORKOS_API_KEY");
process.env.WORKOS_COOKIE_PASSWORD = "test-session-password-for-fixtures-only";
process.env.VITE_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
const { sessionHintHeader, signInGuard } = await import("../server/session");
const { proxyAnalytics } = await import("../server/analyticsProxy");
const { createNonce, withSecurityHeaders } = await import(
  "../server/securityHeaders"
);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the sign-in origin", () => {
  test.each([
    "https://evil.example/settings",
    "https://evil.example/callback?code=old",
    "http://localhost:9999/sign-in",
  ])("denies %s, outside the configured deployment", (url) => {
    const response = signInGuard(new Request(url));
    expect(response?.status).toBe(400);
    expect(response?.headers.get("location")).toBeNull();
  });

  test.each(["/", "/settings?tab=account", "/callback?code=a&state=b"])(
    "lets the app's own origin reach %s",
    (path) => {
      expect(signInGuard(new Request(`http://localhost:3142${path}`))).toBe(
        null
      );
    }
  );

  test.each(["/share", "/sw.js", "/manifest.webmanifest"])(
    "lets %s answer from any origin",
    (path) => {
      expect(signInGuard(new Request(`https://teak.test${path}`))).toBe(null);
    }
  );
});

describe("the session hint teakvault.com reads", () => {
  const hint = (origin: string, cookie: string | null, signedIn: boolean) =>
    sessionHintHeader(
      new Request(`${origin}/`, { headers: cookie ? { cookie } : {} }),
      origin,
      signedIn
    );

  test("tells teakvault.com the browser is signed in, over HTTPS only", () => {
    expect(hint("https://app.teakvault.com", "wos-session=x", true)).toBe(
      "teak_session_hint=1; Path=/; Max-Age=2592000; Domain=teakvault.com; SameSite=Lax; Secure"
    );
  });

  test("clears a signed-in hint the session no longer backs, on its domain", () => {
    expect(
      hint("https://app.teakvault.com", "a=b; teak_session_hint=1", false)
    ).toBe(
      "teak_session_hint=; Path=/; Max-Age=0; Domain=teakvault.com; SameSite=Lax; Secure"
    );
  });

  test("leaves a hint that already matches the session alone", () => {
    expect(
      hint("https://app.teakvault.com", "teak_session_hint=1", true)
    ).toBeNull();
    expect(hint("https://app.teakvault.com", null, false)).toBeNull();
  });

  test("stays on the host, readable by script, off teakvault.com", () => {
    const local = hint("http://localhost:3142", null, true);
    expect(local).toStartWith("teak_session_hint=1;");
    expect(local).not.toContain("Domain=");
    expect(local).not.toContain("Secure");
    expect(local).not.toContain("HttpOnly");
  });
});

describe("signed-in visits to sign-in", () => {
  test.each([
    ["/sign-in?next=%2Fsettings", "http://localhost:3142/settings"],
    ["/sign-in?next=https%3A%2F%2Fevil.example%2F", "http://localhost:3142/"],
    ["/sign-up", "http://localhost:3142/"],
  ])("send %s straight to %s", (path, target) => {
    const redirect = workosEntryRedirect(
      new URL(`http://localhost:3142${path}`),
      true
    );
    expect(redirect?.toString()).toBe(target);
  });

  test.each([
    ["a renewal", "/sign-in?renew=1&next=%2Fsettings", true],
    ["a sign-in after a failed callback", "/sign-in?reauth=1", true],
    ["a signed-out visit", "/sign-in?next=%2Fsettings", false],
    ["any other page", "/settings", true],
  ])("leave %s to AuthKit or the app", (_name, path, signedIn) => {
    expect(
      workosEntryRedirect(new URL(`http://localhost:3142${path}`), signedIn)
    ).toBeNull();
  });
});

describe("the /ingest analytics proxy", () => {
  const forwarded: Request[] = [];
  const posthog = ((input: RequestInfo | URL, init?: RequestInit) => {
    forwarded.push(new Request(input, init));
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;
  const proxy = (path: string, init?: RequestInit) => {
    forwarded.length = 0;
    globalThis.fetch = posthog;
    return proxyAnalytics(new Request(`http://localhost:3142${path}`, init));
  };

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
    "forwards %s to PostHog without the session cookie",
    async (path, target) => {
      const response = await proxy(path, {
        headers: { cookie: "wos-session=secret", "user-agent": "test" },
      });
      expect(await response?.text()).toBe("ok");
      expect(forwarded.map((request) => request.url)).toEqual([target]);
      expect(forwarded[0]?.headers.get("cookie")).toBeNull();
      expect(forwarded[0]?.headers.get("user-agent")).toBe("test");
    }
  );

  test("forwards an event's body", async () => {
    await proxy("/ingest/e/", { method: "POST", body: '{"event":"x"}' });
    expect(forwarded[0]?.method).toBe("POST");
    expect(await forwarded[0]?.text()).toBe('{"event":"x"}');
  });

  test.each([
    "/ingest//evil.example/steal",
    "/ingest//16909060/x",
    "/ingest/%5Cevil.example/x",
  ])("keeps %s on PostHog's host", async (path) => {
    await proxy(path);
    expect(forwarded.map((request) => new URL(request.url).origin)).toEqual([
      "https://us.i.posthog.com",
    ]);
  });

  test.each(["/", "/settings", "/ingestion", "/ingest"])(
    "leaves %s to the app",
    async (path) => {
      expect(await proxy(path)).toBeNull();
      expect(forwarded).toEqual([]);
    }
  );
});

describe("response headers", () => {
  test("every page carries the CSP and is never cached", () => {
    const page = withSecurityHeaders(
      new Response("<html></html>", {
        headers: {
          "Cache-Control": "public, max-age=60",
          "Content-Type": "text/html; charset=utf-8",
        },
      })
    );
    expect(page.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a page's CSP runs inline scripts only with its own nonce", () => {
    const nonce = createNonce();
    expect(nonce).not.toBe(createNonce());
    const page = withSecurityHeaders(
      new Response("<html></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      nonce
    );
    const scriptSrc = page.headers
      .get("content-security-policy")
      ?.split("; ")
      .find((directive) => directive.startsWith("script-src "));
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  test("other responses keep their own caching and headers", () => {
    const manifest = withSecurityHeaders(
      new Response("{}", {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "Content-Type": "application/manifest+json",
          "Referrer-Policy": "no-referrer",
        },
      })
    );
    expect(manifest.headers.get("content-security-policy")).toContain(
      "default-src 'self'"
    );
    expect(manifest.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(manifest.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("a server function's answer without its own caching is never cached", () => {
    const answer = withSecurityHeaders(
      new Response('{"accessToken":"token"}', {
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(answer.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a redirect's immutable headers still get them", () => {
    const redirect = withSecurityHeaders(
      Response.redirect("http://localhost:3142/sign-in", 303)
    );
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe(
      "http://localhost:3142/sign-in"
    );
    expect(redirect.headers.get("content-security-policy")).toBeTruthy();
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
