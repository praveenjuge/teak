import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  createOAuthSession,
  createTeakClient,
  type OAuthCredentials,
  OAuthSessionError,
} from "./index";

const API = "https://api.teak.test";
const ISSUER = "https://auth.teak.test";
const CLIENT = "client_cli";

interface Server {
  apiStatus: number;
  disconnects: number;
  discoveries: number;
  grants: URLSearchParams[];
  /** The token endpoint's answer to a refresh. */
  refreshAnswer: () => Response;
}
let server: Server;
const originalFetch = globalThis.fetch;
let refreshCount = 0;

const tokens = (n: number) =>
  Response.json({
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 3600,
  });

beforeEach(() => {
  refreshCount = 0;
  server = {
    apiStatus: 200,
    disconnects: 0,
    discoveries: 0,
    grants: [],
    refreshAnswer: () => tokens(++refreshCount),
  };
  const route = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === "/.well-known/teak-oauth-clients.json") {
      server.discoveries++;
      return Response.json({
        primary: "workos",
        issuer: ISSUER,
        clients: {
          cli: CLIENT,
          raycast: "client_raycast",
          chrome: "client_chrome",
          firefox: "client_firefox",
        },
        resource: "https://teakvault.com/mcp",
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.href === `${ISSUER}/oauth2/token`) {
      const body = new URLSearchParams(String(init?.body));
      server.grants.push(body);
      return body.get("grant_type") === "refresh_token"
        ? server.refreshAnswer()
        : tokens(0);
    }
    if (url.pathname === "/v1/oauth/disconnect") {
      server.disconnects++;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/v1/me") {
      return server.apiStatus === 200
        ? Response.json({ data: { id: "owner_1", email: "a@b.c" } })
        : Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    }
    throw new Error(`Unexpected ${url.href}`);
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve().then(() => route(input, init))) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const memoryStore = (initial: OAuthCredentials | null) => {
  const store = {
    saved: initial,
    read: () => store.saved,
    write: (next: OAuthCredentials | null) => {
      store.saved = next;
    },
  };
  return store;
};

const signedIn = (overrides: Partial<OAuthCredentials> = {}) => ({
  accessToken: "access-saved",
  refreshToken: "refresh-saved",
  expiresAt: Date.now() + 3_600_000,
  origin: API,
  issuer: ISSUER,
  clientId: CLIENT,
  ownerId: "owner_1",
  ...overrides,
});

const sessionWith = (store: ReturnType<typeof memoryStore>) =>
  createOAuthSession({ apiUrl: API, surface: "cli", store });

describe("createOAuthSession", () => {
  test("sends a fresh saved token without asking discovery", async () => {
    const store = memoryStore(signedIn());
    const token = await sessionWith(store).tokenProvider().getAccessToken();
    expect(token).toBe("access-saved");
    expect(server.discoveries).toBe(0);
  });

  test("refreshes a token inside the refresh margin, once for concurrent requests, and saves the rotation", async () => {
    const store = memoryStore(
      signedIn({
        expiresAt: Date.now() + ACCESS_TOKEN_REFRESH_MARGIN_MS - 1000,
      })
    );
    const provider = sessionWith(store).tokenProvider();
    const tokensSent = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);
    expect(tokensSent).toEqual(["access-1", "access-1"]);
    expect(server.grants.map((grant) => grant.get("refresh_token"))).toEqual([
      "refresh-saved",
    ]);
    expect(store.saved).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      ownerId: "owner_1",
      clientId: CLIENT,
    });
  });

  test("a token with more than the margin left is not refreshed", async () => {
    const store = memoryStore(
      signedIn({
        expiresAt: Date.now() + ACCESS_TOKEN_REFRESH_MARGIN_MS + 5000,
      })
    );
    expect(await sessionWith(store).tokenProvider().getAccessToken()).toBe(
      "access-saved"
    );
    expect(server.grants).toEqual([]);
  });

  test("a 401 refreshes the rejected token instead of signing out", async () => {
    const store = memoryStore(signedIn());
    let calls = 0;
    const api = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/me")) {
        calls++;
        const auth = new Headers(init?.headers).get("authorization");
        return Promise.resolve(
          auth === "Bearer access-saved"
            ? Response.json({ code: "UNAUTHORIZED" }, { status: 401 })
            : Response.json({ data: { id: "owner_1" } })
        );
      }
      return api(input, init);
    }) as typeof fetch;
    const client = createTeakClient({
      baseUrl: API,
      tokenProvider: sessionWith(store).tokenProvider(),
    });
    expect((await client.me()).id).toBe("owner_1");
    expect(calls).toBe(2);
    expect(store.saved?.accessToken).toBe("access-1");
  });

  test("a dead refresh token clears the sign-in and asks for a new one", async () => {
    server.refreshAnswer = () =>
      Response.json({ error: "invalid_grant" }, { status: 400 });
    const store = memoryStore(signedIn({ expiresAt: 0 }));
    expect(await sessionWith(store).tokenProvider().getAccessToken()).toBe(
      null
    );
    expect(store.saved).toBeNull();
  });

  test("a refresh during an outage keeps the sign-in for the next try", async () => {
    server.refreshAnswer = () => new Response(null, { status: 503 });
    const saved = signedIn({ expiresAt: 0 });
    const store = memoryStore(saved);
    const error = await Promise.resolve(
      sessionWith(store).tokenProvider().getAccessToken()
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OAuthSessionError);
    expect((error as OAuthSessionError).reason).toBe("token_rejected");
    expect(store.saved).toEqual(saved);
  });

  test("a sign-in from another client registration is never refreshed or sent once it expires", async () => {
    const saved = signedIn({ clientId: "client_old", expiresAt: 0 });
    const store = memoryStore(saved);
    expect(await sessionWith(store).tokenProvider().getAccessToken()).toBe(
      null
    );
    expect(server.grants).toEqual([]);
    expect(store.saved).toEqual(saved);
  });

  test("a provider for one account refuses another account's sign-in", async () => {
    const store = memoryStore(signedIn({ ownerId: "owner_2" }));
    const error = (await Promise.resolve(
      sessionWith(store).tokenProvider({ ownerId: "owner_1" }).getAccessToken()
    ).catch((caught: unknown) => caught)) as OAuthSessionError;
    expect(error.reason).toBe("account_changed");
  });

  test("signs in through the browser hand-off and saves the verified account", async () => {
    const store = memoryStore(null);
    const redirectUri = "https://app.example/oauth/callback";
    const saved = await sessionWith(store).signIn({
      redirectUri,
      authorize: (url) =>
        Promise.resolve(
          `${redirectUri}?code=the-code&state=${url.searchParams.get("state")}`
        ),
    });
    expect(saved).toMatchObject({
      accessToken: "access-0",
      ownerId: "owner_1",
      origin: API,
      issuer: ISSUER,
      clientId: CLIENT,
    });
    expect(store.saved).toEqual(saved);
    expect(server.grants[0]?.get("code")).toBe("the-code");
    expect(server.grants[0]?.get("redirect_uri")).toBe(redirectUri);
  });

  test("a redirect for another sign-in never exchanges its code", async () => {
    const store = memoryStore(null);
    const redirectUri = "https://app.example/oauth/callback";
    const error = (await sessionWith(store)
      .signIn({
        redirectUri,
        authorize: () =>
          Promise.resolve(`${redirectUri}?code=the-code&state=other`),
      })
      .catch((caught: unknown) => caught)) as OAuthSessionError;
    expect(error.reason).toBe("not_verified");
    expect(server.grants).toEqual([]);
    expect(store.saved).toBeNull();
  });

  test("sign-out during the browser hand-off drops the new grant", async () => {
    const store = memoryStore(null);
    const session = sessionWith(store);
    const redirectUri = "https://app.example/oauth/callback";
    const error = (await session
      .signIn({
        redirectUri,
        authorize: async (url) => {
          await session.signOut();
          return `${redirectUri}?code=c&state=${url.searchParams.get("state")}`;
        },
      })
      .catch((caught: unknown) => caught)) as OAuthSessionError;
    expect(error.reason).toBe("signed_out");
    expect(server.grants).toEqual([]);
    expect(store.saved).toBeNull();
  });

  test("signs out by disconnecting the grant, and says when only this device could be", async () => {
    const live = memoryStore(signedIn());
    expect(await sessionWith(live).signOut()).toBe("disconnected");
    expect(server.disconnects).toBe(1);
    expect(live.saved).toBeNull();

    server.apiStatus = 401;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/v1/oauth/disconnect")
        ? Promise.resolve(new Response(null, { status: 401 }))
        : original(input, init)) as typeof fetch;
    server.refreshAnswer = () =>
      Response.json({ error: "invalid_grant" }, { status: 400 });
    const dead = memoryStore(signedIn());
    expect(await sessionWith(dead).signOut()).toBe("signed-out-here");
    expect(dead.saved).toBeNull();
  });
});
