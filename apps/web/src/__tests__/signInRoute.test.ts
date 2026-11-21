import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { sessionEncryption } from "@workos/authkit-session";

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
const cookiePassword = "test-session-password-for-fixtures-only";
process.env.WORKOS_CLIENT_ID = "client_web123";
// The web app signs in as a public client, without an API key.
Reflect.deleteProperty(process.env, "WORKOS_API_KEY");
process.env.WORKOS_COOKIE_PASSWORD = cookiePassword;
process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "http://localhost:3142/callback";
process.env.NODE_ENV = "development";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://sign-up-tests.convex.cloud";

// AuthKit's server functions read the session and hand the PKCE cookie to
// the response through Start's request context, which only a running app
// has. Here the session is set by the test, and the same AuthKit service the
// server functions use builds the real authorization URL.
const sdk = await import("@workos/authkit-tanstack-react-start");
let sessionUser: { id: string } | null = null;
type UrlOptions = Parameters<typeof sdk.getSignInUrl>[0];
const authorizeUrl =
  (screen: "createSignIn" | "createSignUp") => async (options?: UrlOptions) => {
    const data = options?.data;
    const authkit = await sdk.getAuthkit();
    const urlOptions =
      typeof data === "string" ? { returnPathname: data } : data;
    const { url } =
      screen === "createSignIn"
        ? await authkit.createSignIn(undefined, urlOptions)
        : await authkit.createSignUp(undefined, urlOptions);
    return url;
  };
mock.module("@workos/authkit-tanstack-react-start", () => ({
  ...sdk,
  getAuth: async () => ({ user: sessionUser }),
  getSignInUrl: authorizeUrl("createSignIn"),
  getSignUpUrl: authorizeUrl("createSignUp"),
}));

const { Route: signInRoute } = await import("../routes/sign-in");
const { Route: signUpRoute } = await import("../routes/sign-up");

type Handler = (ctx: { request: Request }) => Promise<Response>;
const serve = (route: { options: unknown }) => (url: string) =>
  (
    route.options as { server: { handlers: { GET: Handler } } }
  ).server.handlers.GET({ request: new Request(url) });
const signIn = serve(signInRoute);
const signUp = serve(signUpRoute);

const offline = ((input: RequestInfo | URL) => {
  throw new Error(`Sign-in must not reach ${String(input)}`);
}) as typeof fetch;

const authorizeParams = (response: Response) => {
  const authorize = new URL(response.headers.get("location") ?? "");
  expect(`${authorize.origin}${authorize.pathname}`).toBe(
    "https://api.workos.com/user_management/authorize"
  );
  return authorize.searchParams;
};

// The sign-up pause is cached for a minute; each test starts past it.
let clock = Date.parse("2026-11-21T00:00:00Z");
beforeEach(() => {
  clock += 10 * 60_000;
  setSystemTime(clock);
  globalThis.fetch = offline;
  sessionUser = null;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});

describe("WorkOS Initiate login URI", () => {
  test.each([
    ["/settings?tab=account", "/settings?tab=account"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/sign-in", "/"],
    ["/sign-up/", "/"],
  ])(
    "starts an AuthKit sign-in with PKCE (next=%s)",
    async (next, returnTo) => {
      const response = await signIn(
        `http://localhost:3142/sign-in?next=${encodeURIComponent(next)}`
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const params = authorizeParams(response);
      expect(Object.fromEntries(params)).toMatchObject({
        client_id: "client_web123",
        provider: "authkit",
        redirect_uri: "http://localhost:3142/callback",
        response_type: "code",
        screen_hint: "sign-in",
        code_challenge_method: "S256",
      });
      const state = await sessionEncryption.unsealData<{
        returnPathname: string;
      }>(params.get("state") ?? "", { password: cookiePassword });
      expect(state.returnPathname).toBe(returnTo);
    }
  );

  test.each([
    ["/sign-in?next=%2Fsettings", "http://localhost:3142/settings"],
    ["/sign-in?next=%2F%2Fevil.example", "http://localhost:3142/"],
    ["/sign-up", "http://localhost:3142/"],
  ])("sends a signed-in visit to %s straight to %s", async (path, target) => {
    sessionUser = { id: "user_test" };
    const route = path.startsWith("/sign-up") ? signUp : signIn;
    const response = await route(`http://localhost:3142${path}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe(target);
  });

  test.each(["/sign-in?renew=1&next=%2Fsettings", "/sign-in?reauth=1"])(
    "lets a signed-in visit to %s start AuthKit",
    async (path) => {
      sessionUser = { id: "user_test" };
      const response = await signIn(`http://localhost:3142${path}`);
      expect(authorizeParams(response).get("screen_hint")).toBe("sign-in");
    }
  );
});

let authModeReads = 0;
const authMode = (signupsDisabled: boolean) =>
  ((input: RequestInfo | URL) => {
    if (String(input) !== "https://sign-up-tests.convex.cloud/api/query") {
      return offline(input);
    }
    authModeReads += 1;
    return Promise.resolve(
      Response.json({
        status: "success",
        value: {
          primary: "workos",
          signupsDisabled,
          accountChangesPaused: false,
        },
        logLines: [],
      })
    );
  }) as typeof fetch;

describe("WorkOS sign-up route", () => {
  test("starts AuthKit on the sign-up screen", async () => {
    globalThis.fetch = authMode(false);
    const response = await signUp(
      "http://localhost:3142/sign-up?next=%2Fsettings"
    );
    expect(response.status).toBe(303);
    const params = authorizeParams(response);
    expect(params.get("screen_hint")).toBe("sign-up");
    expect(params.get("client_id")).toBe("client_web123");
  });

  test.each([
    ["sign-ups are paused", authMode(true)],
    ["the pause flag can't be read", offline],
  ])("opens the sign-in screen when %s", async (_name, fetchImpl) => {
    globalThis.fetch = fetchImpl;
    const response = await signUp("http://localhost:3142/sign-up");
    expect(response.status).toBe(303);
    expect(authorizeParams(response).get("screen_hint")).toBe("sign-in");
  });

  test("reads the pause switch at most once a minute", async () => {
    globalThis.fetch = authMode(false);
    authModeReads = 0;
    await signUp("http://localhost:3142/sign-up");
    setSystemTime(clock + 30_000);
    await signUp("http://localhost:3142/sign-up");
    expect(authModeReads).toBe(1);
    setSystemTime(clock + 61_000);
    await signUp("http://localhost:3142/sign-up");
    expect(authModeReads).toBe(2);
  });
});

describe("sign-in after a failed callback", () => {
  test("asks for credentials again", async () => {
    const response = await signIn("http://localhost:3142/sign-in?reauth=1");
    expect(authorizeParams(response).get("max_age")).toBe("0");
  });
  test("ordinary sign-ins reuse the AuthKit session", async () => {
    const response = await signIn("http://localhost:3142/sign-in");
    expect(authorizeParams(response).has("max_age")).toBe(false);
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
