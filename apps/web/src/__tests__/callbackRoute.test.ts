import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

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
const { getAuthkit } = await import("@workos/authkit-tanstack-react-start");
const { configureWorkos } = await import("../server/workos");
const { Route } = await import("../routes/callback");

type Handler = (ctx: { request: Request }) => Promise<Response>;
const callback = (url: string, cookie?: string) =>
  (
    Route.options as unknown as { server: { handlers: { GET: Handler } } }
  ).server.handlers.GET({
    request: new Request(url, { headers: cookie ? { cookie } : {} }),
  });

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
let reached: string[] = [];
let authenticationMethod: string | undefined = "Password";

// WorkOS's code exchange and JWKS are the only network this flow may reach.
const network = ((input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  reached.push(url);
  const now = new Date().toISOString();
  if (url === "https://api.workos.com/user_management/authenticate") {
    return Promise.resolve(
      Response.json({
        access_token: ACCESS_TOKEN,
        refresh_token: "refresh_test",
        authentication_method: authenticationMethod,
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
          created_at: now,
          updated_at: now,
        },
      })
    );
  }
  if (url === "https://api.workos.com/sso/jwks/client_web123") {
    return Promise.resolve(Response.json({ keys: [publicJwk] }));
  }
  return Promise.reject(new Error(`Callback must not reach ${url}`));
}) as typeof fetch;

// Starts a real AuthKit sign-in, as /sign-in does, so the callback gets a
// state bound to its PKCE cookie.
async function startedSignIn() {
  const { redirectUri } = configureWorkos();
  const authkit = await getAuthkit();
  const started = await authkit.createSignIn(undefined, {
    redirectUri,
    returnPathname: "/settings",
  });
  const state = new URL(started.url).searchParams.get("state") ?? "";
  const cookie =
    started.response?.headers
      .getSetCookie()
      .find((value) => value.startsWith("wos-auth-verifier-"))
      ?.split(";")[0] ?? "";
  return { state, cookie };
}

const finishSignIn = async () => {
  const { state, cookie } = await startedSignIn();
  return callback(
    `http://localhost:3142/callback?code=code_test&state=${encodeURIComponent(state)}`,
    cookie
  );
};

const setCookie = (response: Response, name: string) =>
  response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));

beforeEach(() => {
  globalThis.fetch = network;
  reached = [];
  authenticationMethod = "Password";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sign-in callback", () => {
  test("signs the account in and returns to the page it started from", async () => {
    const response = await finishSignIn();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3142/settings"
    );
    expect(setCookie(response, "wos-session")).toBeTruthy();
    expect(reached).not.toContain(
      "https://callback-tests.convex.cloud/api/action"
    );
  });

  test("tells teakvault.com this browser is signed in", async () => {
    const hint = setCookie(await finishSignIn(), "teak_session_hint");
    expect(hint).toStartWith("teak_session_hint=1;");
    expect(hint).not.toContain("HttpOnly");
    expect(hint).not.toContain("Domain=");
  });

  test("remembers how the account signed in, for its first ensureUser", async () => {
    authenticationMethod = "GoogleOAuth";
    const method = setCookie(await finishSignIn(), "teak_auth_method");
    expect(method).toStartWith("teak_auth_method=GoogleOAuth;");
    expect(method).toContain("Max-Age=600");
  });

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
      const error = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const response = await callback(
          `http://localhost:3142/callback${query}`,
          cookie
        );
        // The SDK catches upstream failures, so this checks the calls: no
        // code exchange may reach WorkOS.
        expect(reached).toEqual([]);
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(
          "http://localhost:3142/sign-in?reauth=1"
        );
        expect(setCookie(response, "wos-session")).toBeUndefined();
        expect(setCookie(response, "teak_session_hint")).toBeUndefined();
        if (query.includes("state=")) {
          expect(
            response.headers
              .getSetCookie()
              .some(
                (value) =>
                  value.startsWith("wos-auth-verifier-") &&
                  value.includes("Max-Age=0")
              )
          ).toBe(true);
        }
      } finally {
        error.mockRestore();
      }
    }
  );
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
