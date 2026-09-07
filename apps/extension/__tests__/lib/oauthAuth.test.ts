/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
const tokenKey = "teakOAuthCredentials";
const accessToken = "a".repeat(32);
const refreshToken = "r".repeat(32);
let storage: Record<string, unknown>;
let webAuth: ReturnType<typeof mock>;
let setAccessLevel: ReturnType<typeof mock>;

beforeEach(() => {
  process.env.VITE_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
  storage = {};
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, callback: () => Promise<unknown>) => {
        const next = tail.then(callback, callback);
        tail = next.catch(() => {});
        return next;
      },
    },
  });
  webAuth = mock(({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get("state");
    return Promise.resolve(
      `https://extension.chromiumapp.org/oauth/callback?state=${state}&code=authorization-code`
    );
  });
  setAccessLevel = mock(() => Promise.resolve());
  globalThis.chrome = {
    identity: {
      getRedirectURL: (path: string) =>
        `https://extension.chromiumapp.org/${path}`,
      launchWebAuthFlow: webAuth,
    },
    storage: {
      local: {
        setAccessLevel,
        get: async (key: string) => ({ [key]: storage[key] }),
        set: (values: Record<string, unknown>) => {
          Object.assign(storage, values);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const key of [keys].flat()) {
            delete storage[key];
          }
          return Promise.resolve();
        },
      },
    },
  } as unknown as typeof chrome;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.chrome = originalChrome;
  if (originalLocks) {
    Object.defineProperty(navigator, "locks", originalLocks);
  } else {
    Reflect.deleteProperty(navigator, "locks");
  }
});
const load = () =>
  import(`../../lib/oauthAuth.ts?test=${crypto.randomUUID()}`) as Promise<
    typeof import("../../lib/oauthAuth")
  >;
const tokenResponse = (access = accessToken, refresh = refreshToken) =>
  Response.json({
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
  });

describe("Chrome OAuth background credentials", () => {
  test("uses native browser PKCE login, protects storage, and returns only display data", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock((input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith("/mcp/token")) {
        return Promise.resolve(tokenResponse());
      }
      return Promise.resolve(
        Response.json({
          sub: "owner",
          email: "owner@example.com",
          name: "Owner",
        })
      );
    }) as unknown as typeof fetch;
    const auth = await load();
    storage.teakSessionToken = "old-native-session";
    await Promise.all([auth.beginOAuthSignIn(), auth.beginOAuthSignIn()]);
    expect(webAuth).toHaveBeenCalledTimes(1);
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(storage.teakSessionToken).toBeUndefined();
    const authorize = new URL(webAuth.mock.calls[0]?.[0].url);
    expect(authorize.origin).toBe("https://app.teakvault.com");
    const token = new URLSearchParams(String(calls[0]?.init?.body));
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token.get("code_verifier")!)
    );
    const challenge = Buffer.from(digest).toString("base64url");
    expect(authorize.searchParams.get("code_challenge")).toBe(challenge);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(token.get("client_id")).toBe("teak-chrome");
    expect(token.get("redirect_uri")).toBe(
      "https://extension.chromiumapp.org/oauth/callback"
    );
    const state = await auth.getOAuthState();
    expect(state).toMatchObject({
      authenticated: true,
      pending: false,
      user: { id: "owner" },
    });
    expect(JSON.stringify(state)).not.toContain(accessToken);
    expect(JSON.stringify(state)).not.toContain(refreshToken);
  });
  test("rejects a mismatched state without exchanging the code", async () => {
    webAuth.mockResolvedValue(
      "https://extension.chromiumapp.org/oauth/callback?state=wrong&code=code"
    );
    const fetchMock = mock(async () => tokenResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect((await load()).beginOAuthSignIn()).rejects.toThrow("verified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage[tokenKey]).toBeUndefined();
  });
  test("survives a worker restart and refreshes concurrent requests only once", async () => {
    storage[tokenKey] = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() - 1,
    };
    let refreshes = 0;
    globalThis.fetch = mock((input, init) => {
      if (String(input).endsWith("/mcp/token")) {
        refreshes += 1;
        expect(
          new URLSearchParams(String(init?.body)).get("refresh_token")
        ).toBe(refreshToken);
        return Promise.resolve(tokenResponse("b".repeat(32), "s".repeat(32)));
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${"b".repeat(32)}`
      );
      return Promise.resolve(Response.json({ cardId: "card" }));
    }) as unknown as typeof fetch;
    const auth = await load();
    await Promise.all([
      auth.oauthRequest("/v1/cards"),
      auth.oauthRequest("/v1/cards"),
      auth.oauthRequest("/v1/cards"),
    ]);
    expect(refreshes).toBe(1);
    const restarted = await load();
    await restarted.oauthRequest("/v1/cards");
    expect(refreshes).toBe(1);
    expect(webAuth).not.toHaveBeenCalled();
  });
  test("clears revoked credentials but preserves credentials on a transient refresh failure", async () => {
    storage[tokenKey] = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() - 1,
    };
    globalThis.fetch = mock(
      async () => new Response(null, { status: 503 })
    ) as unknown as typeof fetch;
    const auth = await load();
    await expect(auth.oauthRequest("/v1/cards")).rejects.toThrow("try again");
    expect(storage[tokenKey]).toBeDefined();
    globalThis.fetch = mock(
      async () => new Response(null, { status: 400 })
    ) as unknown as typeof fetch;
    expect(await auth.oauthRequest("/v1/cards")).toBeNull();
    expect(storage[tokenKey]).toBeUndefined();
  });
  test("an old request's 401 cannot clear a newly refreshed credential", async () => {
    storage[tokenKey] = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 60_000,
    };
    let finish: ((response: Response) => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    globalThis.fetch = mock(() => {
      started?.();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as unknown as typeof fetch;
    const auth = await load();
    const request = auth.oauthRequest("/v1/cards");
    await ready;
    storage[tokenKey] = {
      accessToken: "b".repeat(32),
      refreshToken: "s".repeat(32),
      expiresAt: Date.now() + 60_000,
    };
    finish?.(new Response(null, { status: 401 }));
    expect(await request).toBeNull();
    expect(storage[tokenKey]).toMatchObject({ accessToken: "b".repeat(32) });
  });
  test("local sign-out revokes only its installation credential and waits for success", async () => {
    storage[tokenKey] = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 60_000,
    };
    const auth = await load();
    globalThis.fetch = mock(
      async () => new Response(null, { status: 503 })
    ) as unknown as typeof fetch;
    await expect(auth.signOutOAuth()).rejects.toThrow("Could not sign out");
    expect(storage[tokenKey]).toBeDefined();
    const revoke = mock((_input, init) => {
      expect(new URLSearchParams(String(init?.body)).get("token")).toBe(
        refreshToken
      );
      expect(new URLSearchParams(String(init?.body)).get("client_id")).toBe(
        "teak-chrome"
      );
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    globalThis.fetch = revoke as unknown as typeof fetch;
    await auth.signOutOAuth();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(storage[tokenKey]).toBeUndefined();
  });
});
