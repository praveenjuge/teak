// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  beginSignIn,
  clearLocalSession,
  createCodeChallenge,
  getSessionToken,
  hasPendingFlow,
  pollPendingNativeAuth,
  readPendingNativeAuth,
  signOut,
} from "../../lib/nativeAuth";

const SESSION_TOKEN_KEY = "teakSessionToken";
const DEVICE_ID_KEY = "teakNativeDeviceId";
const PENDING_AUTH_KEY = "teakPendingNativeAuth";

const store = new Map<string, unknown>();

const chromeStub = {
  storage: {
    local: {
      get: (key: string) =>
        Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
      set: (obj: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(obj)) {
          store.set(key, value);
        }
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
          store.delete(key);
        }
        return Promise.resolve();
      },
    },
  },
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  store.clear();
  (globalThis as any).chrome = chromeStub;
  process.env.VITE_PUBLIC_CONVEX_SITE_URL =
    "https://test-deployment.convex.site";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("nativeAuth PKCE", () => {
  test("createCodeChallenge matches the server S256/base64url contract", async () => {
    const verifier = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const challenge = await createCodeChallenge(verifier);

    // Independent reference implementation of SHA-256 -> base64url.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(challenge).toBe(expected);
    // Server's PKCE_CHALLENGE_PATTERN.
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });
});

describe("nativeAuth beginSignIn", () => {
  test("stores a pending flow and builds a valid start URL", async () => {
    const url = new URL(await beginSignIn());

    expect(url.pathname).toBe("/native/auth/start");
    expect(url.searchParams.get("surface")).toBe("browser-extension");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.teakvault.com/native/auth/complete"
    );

    // Params satisfy the server-side validators.
    expect(url.searchParams.get("device_id")).toMatch(/^[A-Za-z0-9-]{16,128}$/);
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const codeChallenge = url.searchParams.get("code_challenge");
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    // Pending record matches the URL, and the challenge derives from the
    // stored verifier (so a poll with this verifier will be accepted).
    const pending = await readPendingNativeAuth();
    expect(pending?.state).toBe(state);
    expect(pending?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(await createCodeChallenge(pending.codeVerifier)).toBe(codeChallenge);
  });

  test("reuses a persistent device id across sign-in attempts", async () => {
    const first = new URL(await beginSignIn()).searchParams.get("device_id");
    const second = new URL(await beginSignIn()).searchParams.get("device_id");
    expect(first).toBe(second);
    expect(store.get(DEVICE_ID_KEY)).toBe(first);
  });
});

describe("nativeAuth pending TTL", () => {
  test("readPendingNativeAuth expires and clears stale flows", async () => {
    await beginSignIn();
    const pending = store.get(PENDING_AUTH_KEY) as { createdAt: number };
    // Age it past the 5-minute server TTL.
    pending.createdAt = Date.now() - 6 * 60 * 1000;
    store.set(PENDING_AUTH_KEY, pending);

    expect(await readPendingNativeAuth()).toBeNull();
    expect(await hasPendingFlow()).toBe(false);
    expect(store.has(PENDING_AUTH_KEY)).toBe(false);
  });
});

describe("nativeAuth pollPendingNativeAuth", () => {
  test("returns no-pending when nothing is in flight", async () => {
    expect(await pollPendingNativeAuth()).toBe("no-pending");
  });

  test("posts codeVerifier/deviceId/state to the poll endpoint", async () => {
    await beginSignIn();
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await pollPendingNativeAuth();

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "https://test-deployment.convex.site/api/native/auth/poll"
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.codeVerifier).toBeString();
    expect(body.deviceId).toBeString();
    expect(body.state).toBeString();
  });

  test("keeps the pending flow on 204", async () => {
    await beginSignIn();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as unknown as typeof fetch;

    expect(await pollPendingNativeAuth()).toBe("pending");
    expect(await getSessionToken()).toBeNull();
    expect(await hasPendingFlow()).toBe(true);
  });

  test("stores the token and clears pending on 200", async () => {
    await beginSignIn();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ sessionToken: "sess_abc", expiresAt: Date.now() }),
          { status: 200 }
        )
      )
    ) as unknown as typeof fetch;

    expect(await pollPendingNativeAuth()).toBe("authenticated");
    expect(await getSessionToken()).toBe("sess_abc");
    expect(await hasPendingFlow()).toBe(false);
  });

  test("clears pending on a terminal 401 without storing a token", async () => {
    await beginSignIn();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "SESSION_INVALID" }), {
          status: 401,
        })
      )
    ) as unknown as typeof fetch;

    expect(await pollPendingNativeAuth()).toBe("error");
    expect(await getSessionToken()).toBeNull();
    expect(await hasPendingFlow()).toBe(false);
  });

  test("keeps the pending flow on a transient network error", async () => {
    await beginSignIn();
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("network"))
    ) as unknown as typeof fetch;

    expect(await pollPendingNativeAuth()).toBe("error");
    // Transient: kept so a later poll can retry.
    expect(await hasPendingFlow()).toBe(true);
  });

  test("keeps the pending flow on a transient 429", async () => {
    await beginSignIn();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429 })
      )
    ) as unknown as typeof fetch;

    expect(await pollPendingNativeAuth()).toBe("error");
    expect(await hasPendingFlow()).toBe(true);
  });
});

describe("nativeAuth session lifecycle", () => {
  test("clearLocalSession drops token + pending but keeps the device id", async () => {
    await beginSignIn(); // establishes device id + pending
    store.set(SESSION_TOKEN_KEY, "sess_abc");

    await clearLocalSession();

    expect(await getSessionToken()).toBeNull();
    expect(await hasPendingFlow()).toBe(false);
    expect(store.get(DEVICE_ID_KEY)).toBeString();
  });

  test("signOut best-effort revokes via bearer then clears local session", async () => {
    store.set(SESSION_TOKEN_KEY, "sess_abc");
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await signOut();

    const [calledUrl, init] = fetchMock.mock.calls[0];
    // Sign-out hits the Convex site URL directly (avoids the http->https
    // redirect that would strip the bearer header).
    expect(calledUrl).toBe("https://test-deployment.convex.site/api/auth/sign-out");
    expect(init.headers.Authorization).toBe("Bearer sess_abc");
    expect(await getSessionToken()).toBeNull();
  });
});
