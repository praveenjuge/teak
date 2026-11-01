import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));
const originalFetch = globalThis.fetch;
const keys = [
  "NEXT_PUBLIC_CONVEX_URL",
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
// The web app signs in as a public client, without an API key.
Reflect.deleteProperty(process.env, "WORKOS_API_KEY");
process.env.WORKOS_COOKIE_PASSWORD = "test-session-password-for-fixtures-only";
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://callback-tests.convex.cloud";
const { serveRoute } = await import("./helpers/serveRoute");
const signIn = serveRoute(await import("../app/sign-in/route"), "/sign-in");
const callback = serveRoute(await import("../app/callback/route"), "/callback");

// AuthKit verifies the access token against the client's JWKS on callback, so
// the fake WorkOS signs a real one.
const signingKey = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"]
);
const publicJwk = {
  ...(await crypto.subtle.exportKey("jwk", signingKey.publicKey)),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");
const encodePart = (value: object) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));
const signedPart = `${encodePart({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${encodePart(
  {
    sub: "user_test",
    sid: "session_test",
    iss: "https://api.workos.com/user_management/client_web123",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  }
)}`;
const ACCESS_TOKEN = `${signedPart}.${base64url(
  new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      signingKey.privateKey,
      new TextEncoder().encode(signedPart)
    )
  )
)}`;
let convexCalls: { path: unknown; authorization: string | null }[] = [];
let createdAt = new Date().toISOString();

// WorkOS's code exchange and JWKS and Convex's HTTP action endpoint are the
// only network this flow may reach. One function for the whole file: the WorkOS
// client keeps the fetch it first sees.
const network = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://api.workos.com/user_management/authenticate") {
    return Promise.resolve(
      Response.json({
        access_token: ACCESS_TOKEN,
        refresh_token: "refresh_test",
        user: {
          object: "user",
          id: "user_test",
          email: "test@example.org",
          email_verified: true,
          first_name: null,
          last_name: null,
          profile_picture_url: null,
          last_sign_in_at: null,
          external_id: null,
          metadata: {},
          created_at: createdAt,
          updated_at: createdAt,
        },
      })
    );
  }
  if (url === "https://api.workos.com/sso/jwks/client_web123") {
    return Promise.resolve(Response.json({ keys: [publicJwk] }));
  }
  if (url === "https://callback-tests.convex.cloud/api/action") {
    const headers = new Headers(init?.headers);
    convexCalls.push({
      path: JSON.parse(String(init?.body)).path,
      authorization: headers.get("authorization"),
    });
    return Promise.resolve(
      Response.json({
        status: "success",
        value: { status: "ok", teakUserId: "teak_new" },
        logLines: [],
      })
    );
  }
  return Promise.reject(new Error(`Callback must not reach ${url}`));
}) as typeof fetch;

// Starts a real sign-in so the callback gets a state bound to its PKCE cookie.
async function startedSignIn() {
  const started = await signIn(
    "http://localhost:3142/sign-in?next=%2Fsettings"
  );
  const state = new URL(started.headers.get("location") ?? "").searchParams.get(
    "state"
  );
  const pkce = started.headers
    .getSetCookie()
    .find((value) => value.startsWith("wos-auth-verifier-"))
    ?.split(";")[0];
  return { state: state ?? "", cookie: pkce ?? "" };
}

const finishSignIn = async (accountCreatedAt: string) => {
  createdAt = accountCreatedAt;
  const { state, cookie } = await startedSignIn();
  return callback(
    `http://localhost:3142/callback?code=code_test&state=${encodeURIComponent(state)}`,
    { cookie }
  );
};

const setCookie = (response: Response, name: string) =>
  response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));

beforeEach(() => {
  globalThis.fetch = network;
  convexCalls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sign-in callback", () => {
  test.each([
    ["a brand-new", () => new Date().toISOString()],
    ["a returning", () => "2025-01-01T00:00:00.000Z"],
  ])(
    "signs %s account in and leaves its Teak user to the app",
    async (_label, createdAt) => {
      const response = await finishSignIn(createdAt());
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3142/settings"
      );
      expect(setCookie(response, "wos-session")).toBeTruthy();
      expect(convexCalls).toEqual([]);
    }
  );
  test("tells teakvault.com this browser is signed in", async () => {
    const response = await finishSignIn("2025-01-01T00:00:00.000Z");
    const hint = setCookie(response, "teak_session_hint");
    expect(hint).toStartWith("teak_session_hint=1;");
    expect(hint).not.toContain("HttpOnly");
    expect(hint).not.toContain("Domain=");
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
