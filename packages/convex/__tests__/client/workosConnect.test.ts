import { afterEach, describe, expect, test } from "bun:test";
import {
  type AuthDiscovery,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  disconnectConnectGrant,
  fetchConnectOwnerId,
  randomBase64Url,
  requestConnectTokens,
} from "../../client/sdk";

const auth: AuthDiscovery = {
  primary: "workos",
  issuer: "https://auth.example",
  authorizationEndpoint: "https://auth.example/oauth2/authorize",
  tokenEndpoint: "https://auth.example/oauth2/token",
  resource: "https://teakvault.com/mcp",
  clients: {
    cli: "client_CLI",
    raycast: "client_RAYCAST",
    chrome: "client_CHROME",
    firefox: "client_FIREFOX",
    safari: "client_SAFARI",
  },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const transport = (respond: (url: string, init: RequestInit) => Response) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(respond(call.url, call.init));
  }) as typeof fetch;
  return calls;
};

const refreshGrant = { grant_type: "refresh_token", refresh_token: "refresh" };

describe("PKCE", () => {
  test("derives the RFC 7636 appendix B S256 challenge", async () => {
    expect(
      await createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("random verifiers are unpadded base64url of the requested entropy", () => {
    const first = randomBase64Url(32);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomBase64Url(24)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomBase64Url(32)).not.toBe(first);
  });
});

test("authorize URL requests a refresh-capable API grant with S256 PKCE", () => {
  const url = createConnectAuthorizeUrl(
    { ...auth, authorizationEndpoint: `${auth.authorizationEndpoint}?org=1` },
    {
      clientId: "client_CHROME",
      codeChallenge: "challenge",
      redirectUri: "https://extension.example/oauth/callback",
      state: "state",
    }
  );
  expect(`${url.origin}${url.pathname}`).toBe(auth.authorizationEndpoint);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    org: "1",
    response_type: "code",
    client_id: "client_CHROME",
    resource: "https://teakvault.com/api",
    redirect_uri: "https://extension.example/oauth/callback",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    scope: "openid profile email offline_access",
    state: "state",
  });
});

describe("token requests", () => {
  test("posts the grant for the API resource without cookies or redirects", async () => {
    const calls = transport(() =>
      Response.json({
        access_token: "access",
        refresh_token: "rotated",
        expires_in: 300,
      })
    );
    const before = Date.now();
    const result = await requestConnectTokens(auth, {
      clientId: "client_CLI",
      grant: refreshGrant,
    });
    expect(result.ok && result.tokens).toMatchObject({
      accessToken: "access",
      refreshToken: "rotated",
    });
    const expiresAt = result.ok ? result.tokens.expiresAt : 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(auth.tokenEndpoint);
    expect(call?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
    });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(call?.init.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(
      Object.fromEntries(new URLSearchParams(String(call?.init.body)))
    ).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh",
      client_id: "client_CLI",
      resource: "https://teakvault.com/api",
    });
  });

  test.each([
    [400, '{"error":"invalid_grant"}', refreshGrant, "refresh_token_rejected"],
    [
      401,
      '{"error":"invalid_refresh_token"}',
      refreshGrant,
      "refresh_token_rejected",
    ],
    [
      401,
      '{"code":"invalid_refresh_token"}',
      refreshGrant,
      "refresh_token_rejected",
    ],
    [401, '{"error":"invalid_client"}', refreshGrant, "rejected"],
    [401, "", refreshGrant, "rejected"],
    [400, "not-json", refreshGrant, "rejected"],
    [
      400,
      '{"error":"invalid_grant"}',
      { grant_type: "authorization_code" },
      "rejected",
    ],
    [503, '{"error":"invalid_grant"}', refreshGrant, "failed"],
    [302, "", refreshGrant, "failed"],
  ] as const)(
    "classifies HTTP%i %s for %o as %s",
    async (status: number, body: string, grant: Record<
      string,
      string
    >, reason: string) => {
      transport(() => new Response(body, { status }));
      expect(
        await requestConnectTokens(auth, { clientId: "client_CLI", grant })
      ).toEqual({ ok: false, reason, status });
    }
  );

  test.each([
    ["missing access token", { refresh_token: "r", expires_in: 60 }],
    [
      "empty refresh token",
      { access_token: "a", refresh_token: "", expires_in: 60 },
    ],
    [
      "string lifetime",
      { access_token: "a", refresh_token: "r", expires_in: "60" },
    ],
    ["zero lifetime", { access_token: "a", refresh_token: "r", expires_in: 0 }],
    [
      "fractional lifetime",
      { access_token: "a", refresh_token: "r", expires_in: 1.5 },
    ],
    [
      "lifetime over a year",
      {
        access_token: "a",
        refresh_token: "r",
        expires_in: 365 * 24 * 3600 + 1,
      },
    ],
    [
      "array payload",
      [{ access_token: "a", refresh_token: "r", expires_in: 60 }],
    ],
    ["malformed JSON", "{"],
    [
      "oversized payload",
      { access_token: "a".repeat(70_000), refresh_token: "r", expires_in: 60 },
    ],
  ])(
    "rejects a 2xx token response with %s",
    async (_name: string, payload: unknown) => {
      transport(
        () =>
          new Response(
            typeof payload === "string" ? payload : JSON.stringify(payload)
          )
      );
      expect(
        await requestConnectTokens(auth, {
          clientId: "client_CLI",
          grant: refreshGrant,
        })
      ).toEqual({ ok: false, reason: "invalid_response", status: 200 });
    }
  );

  test.each([
    ["http://auth.example/oauth2/token", true],
    ["https://169.254.169.254/token", true],
    ["https://user:secret@auth.example/token", true],
    ["http://localhost:7500/token", false],
  ])(
    "never sends credentials to unsafe endpoint %s (local=%p)",
    async (tokenEndpoint: string, local: boolean) => {
      const calls = transport(() => new Response(null, { status: 204 }));
      await expect(
        requestConnectTokens(
          { ...auth, tokenEndpoint },
          { clientId: "client_CLI", grant: refreshGrant, local }
        )
      ).rejects.toThrow("Unsafe OAuth discovery URL");
      expect(calls).toHaveLength(0);
    }
  );
});

describe("disconnect", () => {
  test.each([
    ["https://teak.example", "https://teak.example/v1/oauth/disconnect"],
    [
      "https://teak.example/api/",
      "https://teak.example/api/v1/oauth/disconnect",
    ],
    [
      "https://teak.example/api/v1",
      "https://teak.example/api/v1/oauth/disconnect",
    ],
  ])(
    "confirms only an exact 204 from %s",
    async (apiUrl: string, endpoint: string) => {
      const calls = transport(() => new Response(null, { status: 204 }));
      expect(await disconnectConnectGrant(apiUrl, "access")).toBe(
        "disconnected"
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(endpoint);
      expect(calls[0]?.init).toMatchObject({
        method: "POST",
        credentials: "omit",
        redirect: "error",
      });
      expect(calls[0]?.init.body).toBeUndefined();
      expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe(
        "Bearer access"
      );
    }
  );

  test.each([200, 302, 503])(
    "treats HTTP%i as unconfirmed without refreshing",
    async (status: number) => {
      let refreshed = false;
      transport(() => new Response(null, { status }));
      expect(
        await disconnectConnectGrant("https://teak.example", "access", {
          refreshAccessToken: () => {
            refreshed = true;
            return Promise.resolve("renewed");
          },
        })
      ).toBe("unconfirmed");
      expect(refreshed).toBe(false);
    }
  );

  test.each([
    [204, "disconnected"],
    [401, "unconfirmed"],
  ] as const)(
    "refreshes once after a 401 and retries with the renewed token (retry HTTP%i)",
    async (retryStatus: number, outcome: string) => {
      let refreshes = 0;
      const calls = transport((_url, init) =>
        new Headers(init.headers).get("Authorization") === "Bearer access"
          ? new Response(null, { status: 401 })
          : new Response(null, { status: retryStatus })
      );
      expect(
        await disconnectConnectGrant("https://teak.example", "access", {
          refreshAccessToken: () => {
            refreshes++;
            return Promise.resolve("renewed");
          },
        })
      ).toBe(outcome);
      expect(refreshes).toBe(1);
      expect(
        calls.map((call) => new Headers(call.init.headers).get("Authorization"))
      ).toEqual(["Bearer access", "Bearer renewed"]);
    }
  );

  test("stops after a 401 when the refresh credential is rejected", async () => {
    const calls = transport(() => new Response(null, { status: 401 }));
    expect(
      await disconnectConnectGrant("https://teak.example", "access", {
        refreshAccessToken: () => Promise.resolve(null),
      })
    ).toBe("refresh_rejected");
    expect(calls).toHaveLength(1);
  });

  test("a 401 without a refresh path is unconfirmed", async () => {
    transport(() => new Response(null, { status: 401 }));
    expect(await disconnectConnectGrant("https://teak.example", "access")).toBe(
      "unconfirmed"
    );
  });

  test("allows a loopback API only for local development", async () => {
    const calls = transport(() => new Response(null, { status: 204 }));
    await expect(
      disconnectConnectGrant("http://localhost:3211", "access")
    ).rejects.toThrow("Unsafe OAuth discovery URL");
    expect(calls).toHaveLength(0);
    expect(
      await disconnectConnectGrant("http://localhost:3211", "access", {
        local: true,
      })
    ).toBe("disconnected");
  });
});

describe("owner binding", () => {
  test("returns the account that owns the access token", async () => {
    const calls = transport(() =>
      Response.json({ data: { id: "user_1", email: "owner@example.com" } })
    );
    expect(
      await fetchConnectOwnerId("https://teak.example/api", "access")
    ).toBe("user_1");
    expect(calls[0]?.url).toBe("https://teak.example/api/v1/me");
    expect(calls[0]?.init).toMatchObject({
      credentials: "omit",
      redirect: "error",
    });
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe(
      "Bearer access"
    );
  });

  test.each([
    [
      "an unauthorized response",
      () => Response.json({ data: { id: "user_1" } }, { status: 401 }),
    ],
    ["malformed JSON", () => new Response("not json")],
    ["a missing id", () => Response.json({ data: {} })],
    ["an empty id", () => Response.json({ data: { id: "" } })],
    ["a numeric id", () => Response.json({ data: { id: 1 } })],
  ])(
    "confirms no owner for %s",
    async (_name: string, respond: () => Response) => {
      transport(respond);
      expect(
        await fetchConnectOwnerId("https://teak.example", "access")
      ).toBeNull();
    }
  );
});
