/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
const originalEnv = {
  BROWSER: process.env.BROWSER,
  DEV: process.env.DEV,
  VITE_PUBLIC_CONVEX_SITE_URL: process.env.VITE_PUBLIC_CONVEX_SITE_URL,
};
let primary = "betterauth";
const tokenKey = "teakOAuthCredentials";
const accessToken = "a".repeat(32);
const refreshToken = "r".repeat(32);
let storage: Record<string, unknown>;
let webAuth: ReturnType<typeof mock>;
let setAccessLevel: ReturnType<typeof mock>;

beforeEach(() => {
  process.env.BROWSER = "chrome";
  process.env.VITE_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
  delete process.env.DEV;
  primary = "betterauth";
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
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
  globalThis.chrome = originalChrome;
  if (originalLocks) {
    Object.defineProperty(navigator, "locks", originalLocks);
  } else {
    Reflect.deleteProperty(navigator, "locks");
  }
});
const withDiscovery = (handler: typeof fetch): typeof fetch =>
  (async (input, init) => {
    const url = String(input);
    const issuer =
      primary === "workos"
        ? "https://auth.test.workos.com"
        : "https://app.teakvault.com";
    if (url.endsWith("/.well-known/oauth-protected-resource/mcp")) {
      return Response.json({
        resource: process.env.DEV
          ? "https://test.convex.site/mcp"
          : "https://teakvault.com/mcp",
        authorization_servers: [issuer],
      });
    }
    if (url.endsWith("/.well-known/teak-oauth-clients.json")) {
      return Response.json({
        primary,
        issuer,
        clients: Object.fromEntries(
          ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
            surface,
            primary === "workos" ? `client_${surface}` : `teak-${surface}`,
          ])
        ),
      });
    }
    if (url.includes("/.well-known/oauth-authorization-server")) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}${primary === "workos" ? "/oauth2/authorize" : "/api/auth/mcp/authorize"}`,
        token_endpoint:
          primary === "workos"
            ? `${issuer}/oauth2/token`
            : "https://test.convex.site/api/auth/mcp/token",
        revocation_endpoint: "https://test.convex.site/api/oauth/revoke",
        code_challenge_methods_supported: ["S256"],
      });
    }
    return await handler(input, init);
  }) as typeof fetch;
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
    globalThis.fetch = withDiscovery(
      mock((input, init) => {
        calls.push({ url: String(input), init });
        if (String(input).endsWith("/mcp/token")) {
          return Promise.resolve(tokenResponse());
        }
        return Promise.resolve(
          Response.json({
            data: { id: "owner", email: "owner@example.com", name: "Owner" },
          })
        );
      }) as unknown as typeof fetch
    );
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
  test("Firefox initializes without exposing credentials through unsupported storage access controls", async () => {
    process.env.BROWSER = "firefox";
    Reflect.deleteProperty(chrome.storage.local, "setAccessLevel");
    const auth = await load();
    await expect(auth.initializeAuth()).resolves.toBeUndefined();
    expect(storage[tokenKey]).toBeUndefined();
  });
  test("Firefox uses its registered client and native redirect URI", async () => {
    process.env.BROWSER = "firefox";
    Reflect.deleteProperty(chrome.storage.local, "setAccessLevel");
    const redirect =
      "https://810ad09f1a9233882b69a56ac05bd31b93aad88b.extensions.allizom.org/oauth/callback";
    chrome.identity.getRedirectURL = () => redirect;
    webAuth.mockImplementation(({ url }: { url: string }) => {
      const authorize = new URL(url);
      expect(authorize.searchParams.get("client_id")).toBe("teak-firefox");
      expect(authorize.searchParams.get("redirect_uri")).toBe(redirect);
      return Promise.resolve(`${redirect}?state=wrong&code=code`);
    });
    const fetchMock = mock(async () => tokenResponse());
    globalThis.fetch = withDiscovery(fetchMock as unknown as typeof fetch);
    await expect((await load()).beginOAuthSignIn()).rejects.toThrow("verified");
    expect(webAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("rejects a mismatched state without exchanging the code", async () => {
    webAuth.mockResolvedValue(
      "https://extension.chromiumapp.org/oauth/callback?state=wrong&code=code"
    );
    const fetchMock = mock(async () => tokenResponse());
    globalThis.fetch = withDiscovery(fetchMock as unknown as typeof fetch);
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
    globalThis.fetch = withDiscovery(
      mock((input, init) => {
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
      }) as unknown as typeof fetch
    );
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
    globalThis.fetch = withDiscovery(
      mock(
        async () => new Response(null, { status: 503 })
      ) as unknown as typeof fetch
    );
    const auth = await load();
    await expect(auth.oauthRequest("/v1/cards")).rejects.toThrow("try again");
    expect(storage[tokenKey]).toBeDefined();
    globalThis.fetch = withDiscovery(
      mock(
        async () => new Response(null, { status: 400 })
      ) as unknown as typeof fetch
    );
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
    globalThis.fetch = withDiscovery(
      mock(() => {
        started?.();
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }) as unknown as typeof fetch
    );
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
    globalThis.fetch = withDiscovery(
      mock(
        async () => new Response(null, { status: 503 })
      ) as unknown as typeof fetch
    );
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
    globalThis.fetch = withDiscovery(revoke as unknown as typeof fetch);
    await auth.signOutOAuth();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(storage[tokenKey]).toBeUndefined();
  });
});

test("WorkOS discovery selects the registered client, API audience, and permanent Teak owner", async () => {
  primary = "workos";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = withDiscovery((async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://auth.test.workos.com/oauth2/token") {
      return await Promise.resolve(tokenResponse());
    }
    if (url === "https://test.convex.site/v1/me") {
      return Response.json({
        data: { id: "permanent-owner", email: "owner@example.com" },
      });
    }
    throw new Error("Unexpected authentication endpoint");
  }) as typeof fetch);
  const auth = await load();
  await auth.beginOAuthSignIn();
  const authorize = new URL(webAuth.mock.calls[0]?.[0].url);
  expect(authorize.origin).toBe("https://auth.test.workos.com");
  expect(authorize.searchParams.get("client_id")).toBe("client_chrome");
  expect(authorize.searchParams.get("resource")).toBe(
    "https://teakvault.com/api"
  );
  const exchange = new URLSearchParams(String(calls[0]?.init?.body));
  expect(exchange.get("client_id")).toBe("client_chrome");
  expect(exchange.get("resource")).toBe("https://teakvault.com/api");
  expect(await auth.getCaptureOwner()).toBe("permanent-owner");
  expect((await auth.getOAuthState()).user?.id).toBe("permanent-owner");
});

test("a provider flip during the browser callback never exchanges the old code", async () => {
  const originalFlow = webAuth.getMockImplementation()!;
  webAuth.mockImplementation(async (options) => {
    const callback = await originalFlow(options);
    primary = "workos";
    return callback;
  });
  const network = mock(async () => tokenResponse());
  globalThis.fetch = withDiscovery(network as unknown as typeof fetch);
  await expect((await load()).beginOAuthSignIn()).rejects.toThrow(
    "provider changed"
  );
  expect(network).not.toHaveBeenCalled();
  expect(storage[tokenKey]).toBeUndefined();
});

test("a stored credential is never sent to a different provider", async () => {
  primary = "workos";
  storage[tokenKey] = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 60_000,
    siteUrl: "https://test.convex.site",
    issuer: "https://app.teakvault.com",
    clientId: "teak-chrome",
  };
  storage.teakOAuthOwner = "original-owner";
  const network = mock(async () => tokenResponse());
  globalThis.fetch = withDiscovery(network as unknown as typeof fetch);
  const auth = await load();
  expect(await auth.oauthRequest("/v1/cards")).toBeNull();
  expect(network).not.toHaveBeenCalled();
  expect(storage[tokenKey]).toBeUndefined();
  expect(await auth.getCaptureOwner()).toBe("original-owner");
});

test("development cannot read or clear production credentials", async () => {
  process.env.DEV = "true";
  const production = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 60_000,
  };
  storage[tokenKey] = production;
  storage.teakOAuthOwner = "production-owner";
  const auth = await load();
  expect(await auth.oauthRequest("/v1/cards")).toBeNull();
  expect(await auth.getCaptureOwner()).toBeUndefined();
  await auth.signOutOAuth();
  expect(storage[tokenKey]).toBe(production);
  expect(storage.teakOAuthOwner).toBe("production-owner");
});

test("a provider flip while refreshing cannot publish or send the old-provider token", async () => {
  storage[tokenKey] = { accessToken, refreshToken, expiresAt: Date.now() - 1 };
  const network = mock(async (input) => {
    if (String(input).endsWith("/mcp/token")) {
      primary = "workos";
      return await Promise.resolve(tokenResponse("new-access", "new-refresh"));
    }
    throw new Error("Old provider token escaped");
  });
  globalThis.fetch = withDiscovery(network as unknown as typeof fetch);
  expect(await (await load()).oauthRequest("/v1/cards")).toBeNull();
  expect(network).toHaveBeenCalledTimes(1);
  expect(storage[tokenKey]).toBeUndefined();
});

test("rejects foreign API paths before reading or sending credentials", async () => {
  storage[tokenKey] = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 60_000,
  };
  const network = mock(async () => tokenResponse());
  globalThis.fetch = network as unknown as typeof fetch;
  const auth = await load();
  for (const path of [
    "https://attacker.example/v1/cards",
    "//attacker.example/v1/cards",
    "/\\attacker.example/v1/cards",
  ]) {
    await expect(auth.oauthRequest(path)).rejects.toThrow(
      "Invalid Teak API path"
    );
  }
  expect(network).not.toHaveBeenCalled();
});

test("unsafe discovery stops before the browser flow or token transmission", async () => {
  const metadata = withDiscovery((async () => {
    await Promise.reject(new Error("Token leaked"));
  }) as unknown as typeof fetch);
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes("/.well-known/oauth-authorization-server")) {
      return Response.json({
        issuer: "https://app.teakvault.com",
        authorization_endpoint: "https://app.teakvault.com/authorize",
        token_endpoint: "http://10.0.0.1/token",
        code_challenge_methods_supported: ["S256"],
      });
    }
    return await metadata(input, init);
  }) as typeof fetch;
  await expect((await load()).beginOAuthSignIn()).rejects.toThrow(
    "Unsafe OAuth discovery URL"
  );
  expect(webAuth).not.toHaveBeenCalled();
  expect(storage[tokenKey]).toBeUndefined();
});

test("a malformed identity response revokes the new credential without saving it", async () => {
  let revoked = false;
  globalThis.fetch = withDiscovery((async (input) => {
    const url = String(input);
    if (url.endsWith("/mcp/token")) {
      return tokenResponse();
    }
    if (url.endsWith("/revoke")) {
      revoked = true;
      return new Response(null, { status: 200 });
    }
    return await Promise.resolve(new Response("not json"));
  }) as typeof fetch);
  await expect((await load()).beginOAuthSignIn()).rejects.toThrow();
  expect(revoked).toBe(true);
  expect(storage[tokenKey]).toBeUndefined();
});

test("sign-out during refresh revokes the rotated credential and never sends it to the API", async () => {
  storage[tokenKey] = { accessToken, refreshToken, expiresAt: Date.now() - 1 };
  let finishRefresh: ((value: Response) => void) | undefined;
  let startedRefresh: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedRefresh = resolve;
  });
  const revocation: { token: string | null } = { token: null };
  globalThis.fetch = withDiscovery(((input, init) => {
    const url = String(input);
    if (url.endsWith("/mcp/token")) {
      startedRefresh?.();
      return new Promise<Response>((resolve) => {
        finishRefresh = resolve;
      });
    }
    if (url.endsWith("/revoke")) {
      revocation.token = new URLSearchParams(String(init?.body)).get("token");
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return Promise.reject(new Error("Credential escaped after sign-out"));
  }) as typeof fetch);
  const auth = await load();
  const request = auth.oauthRequest("/v1/cards");
  await started;
  const signOut = auth.signOutOAuth();
  finishRefresh?.(tokenResponse("rotated-access", "rotated-refresh"));
  expect(await request).toBeNull();
  await signOut;
  expect(revocation.token).toBe("rotated-refresh");
  expect(storage[tokenKey]).toBeUndefined();
});

test("a discovery outage after rotation preserves the new refresh credential without sending it", async () => {
  storage[tokenKey] = { accessToken, refreshToken, expiresAt: Date.now() - 1 };
  let rotated = false;
  const network = withDiscovery(((input) => {
    if (String(input).endsWith("/mcp/token")) {
      rotated = true;
      return Promise.resolve(
        tokenResponse("rotated-access", "rotated-refresh")
      );
    }
    return Promise.reject(new Error("API request escaped during outage"));
  }) as typeof fetch);
  globalThis.fetch = ((input, init) =>
    rotated && String(input).includes("/.well-known/")
      ? Promise.reject(new Error("Metadata unavailable"))
      : network(input, init)) as typeof fetch;
  const auth = await load();
  await expect(auth.oauthRequest("/v1/cards")).rejects.toThrow(
    "Metadata unavailable"
  );
  expect(storage[tokenKey]).toMatchObject({
    accessToken: "rotated-access",
    refreshToken: "rotated-refresh",
  });
  await expect(auth.signOutOAuth()).rejects.toThrow("Metadata unavailable");
  expect(storage[tokenKey]).toMatchObject({ refreshToken: "rotated-refresh" });
});

test("sign-out during discovery prevents a nonexpired token from reaching the API", async () => {
  storage[tokenKey] = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 60_000,
  };
  let release: (() => void) | undefined;
  let notify: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const network = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status: 200 }))
  );
  const metadata = withDiscovery(network as unknown as typeof fetch);
  globalThis.fetch = (async (input, init) => {
    if (first && String(input).endsWith("teak-oauth-clients.json")) {
      first = false;
      notify?.();
      await delayed;
    }
    return metadata(input, init);
  }) as typeof fetch;
  const auth = await load();
  const request = auth.oauthRequest("/v1/cards");
  await started;
  const signOut = auth.signOutOAuth();
  release?.();
  expect(await request).toBeNull();
  await signOut;
  expect(network).toHaveBeenCalledTimes(1);
  expect(String(network.mock.calls[0]?.[0])).toEndWith("/revoke");
  expect(storage[tokenKey]).toBeUndefined();
});

test("refresh failures rediscover a provider change before the next request", async () => {
  storage[tokenKey] = { accessToken, refreshToken, expiresAt: Date.now() - 1 };
  let attempts = 0;
  globalThis.fetch = withDiscovery(((input) => {
    if (!String(input).endsWith("/mcp/token")) {
      return Promise.reject(new Error("Unexpected credential transmission"));
    }
    attempts += 1;
    primary = "workos";
    return Promise.resolve(new Response(null, { status: 503 }));
  }) as typeof fetch);
  const auth = await load();
  await expect(auth.oauthRequest("/v1/cards")).rejects.toThrow("try again");
  expect(storage[tokenKey]).toBeDefined();
  expect(await auth.oauthRequest("/v1/cards")).toBeNull();
  expect(attempts).toBe(1);
});

test("identity verification keeps its error when cleanup revocation is unavailable", async () => {
  globalThis.fetch = withDiscovery(((input) => {
    const url = String(input);
    if (url.endsWith("/mcp/token")) {
      return Promise.resolve(tokenResponse());
    }
    return Promise.resolve(
      new Response(null, { status: url.endsWith("/revoke") ? 503 : 403 })
    );
  }) as typeof fetch);
  await expect((await load()).beginOAuthSignIn()).rejects.toThrow(
    "Could not verify your account"
  );
  expect(storage[tokenKey]).toBeUndefined();
});
