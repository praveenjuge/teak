import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type SessionStorage, WorkosSession } from "../../lib/workos-session";

// Expo AuthSession and the system browser are hardware boundaries. The actual
// session manager and exchange are exercised; state mismatch/cancel/error must
// never reach the token endpoint, and sign-out invalidates an open browser flow.
let result: Record<string, unknown>;
let config: Record<string, unknown>;
let prompt: (() => Promise<unknown>) | undefined;
let logoutUrl = "";
mock.module("expo-auth-session", () => ({
  CodeChallengeMethod: { S256: "S256" },
  ResponseType: { Code: "code" },
  AuthRequest: class {
    state = "expected-state";
    codeVerifier = "v".repeat(43);
    constructor(options: Record<string, unknown>) {
      config = options;
    }
    makeAuthUrlAsync(discovery: { authorizationEndpoint: string }) {
      expect(discovery.authorizationEndpoint).toBe(
        "https://api.workos.com/user_management/authorize"
      );
      return Promise.resolve(
        "https://api.workos.com/user_management/authorize"
      );
    }
    promptAsync(discovery: { authorizationEndpoint: string }) {
      expect(discovery.authorizationEndpoint).toBe(
        "https://api.workos.com/user_management/authorize"
      );
      return prompt ? prompt() : Promise.resolve(result);
    }
  },
}));
const nativeCredentials = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItemAsync: (key: string) =>
    Promise.resolve(nativeCredentials.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    nativeCredentials.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    nativeCredentials.delete(key);
    return Promise.resolve();
  },
}));
mock.module("expo-web-browser", () => ({
  maybeCompleteAuthSession: () => {},
  openBrowserAsync: (url: string) => {
    logoutUrl = url;
    return Promise.resolve({ type: "dismiss" });
  },
}));
const {
  signInWithWorkos,
  openWorkosLogout,
  WORKOS_REDIRECT_URI,
  getWorkosSession,
} = await import("../../lib/workos-native-auth");
const clientId = "client_TEST";
const expiry = Math.floor(Date.now() / 1000) + 120;
function setup() {
  let credential: string | null = null;
  let exchanges = 0;
  const storage: SessionStorage = {
    getItemAsync: () => Promise.resolve(credential),
    setItemAsync: (_key, value) => {
      credential = value;
      return Promise.resolve();
    },
    deleteItemAsync: () => {
      credential = null;
      return Promise.resolve();
    },
  };
  const transport: typeof fetch = (_url, init) => {
    exchanges += 1;
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: clientId,
      grant_type: "authorization_code",
      code: "code",
      code_verifier: "v".repeat(43),
    });
    const claims = {
      iss: `https://api.workos.com/user_management/${clientId}`,
      sub: "user_ONE",
      sid: "session_ONE",
      exp: expiry,
    };
    return Promise.resolve(
      Response.json({
        access_token: `header.${btoa(JSON.stringify(claims))}.signature`,
        refresh_token: "refresh",
        user: {
          id: "user_ONE",
          email: "hello@example.com",
          email_verified: true,
          external_id: "permanent-vault",
        },
      })
    );
  };
  return {
    session: new WorkosSession(clientId, storage, transport),
    count: () => exchanges,
    stored: () => credential,
  };
}
beforeEach(() => {
  result = {
    type: "success",
    params: { state: "expected-state", code: "code" },
  };
  prompt = undefined;
  logoutUrl = "";
});
describe("native AuthKit browser flow", () => {
  test.each(["authkit", "GoogleOAuth", "AppleOAuth"] as const)(
    "signs in with %s using public S256 PKCE",
    async (provider: "authkit" | "GoogleOAuth" | "AppleOAuth") => {
      const s = setup();
      expect(await signInWithWorkos(s.session, provider)).toBe(true);
      expect(config).toEqual({
        clientId,
        redirectUri: WORKOS_REDIRECT_URI,
        responseType: "code",
        usePKCE: true,
        codeChallengeMethod: "S256",
        extraParams: { provider },
      });
      expect(s.session.getSnapshot().user?.teakUserId).toBe("permanent-vault");
      expect(s.count()).toBe(1);
    }
  );
  test.each(["cancel", "dismiss"])(
    "%s does not exchange a code",
    async (type: string) => {
      const s = setup();
      result = { type };
      expect(await signInWithWorkos(s.session)).toBe(false);
      expect(s.count()).toBe(0);
    }
  );
  test.each([
    { type: "success", params: { state: "wrong-state", code: "code" } },
    { type: "success", params: { state: "expected-state" } },
    { type: "error", params: { state: "expected-state", code: "code" } },
  ])(
    "rejects invalid callbacks without transmitting credentials",
    async (callback: Record<string, unknown>) => {
      const s = setup();
      result = callback;
      await expect(signInWithWorkos(s.session)).rejects.toThrow(
        "Unable to complete sign-in"
      );
      expect(s.count()).toBe(0);
      expect(s.stored()).toBeNull();
    }
  );
  test("sign-out while the browser is open cancels the pending exchange", async () => {
    const s = setup();
    prompt = async () => {
      await s.session.clear();
      return result;
    };
    expect(await signInWithWorkos(s.session)).toBe(false);
    expect(s.count()).toBe(0);
    expect(s.stored()).toBeNull();
  });
  test("opens logout for the real session and rejects injected session IDs", async () => {
    await openWorkosLogout("session_ONE");
    expect(logoutUrl).toBe(
      "https://api.workos.com/user_management/sessions/logout?session_id=session_ONE"
    );
    await expect(
      openWorkosLogout("session_ONE&return_to=https://other.example")
    ).rejects.toThrow("Invalid session");
  });
});

let bootstrapFixture = 0;
test.each(["ok", "verify_email", "frozen", "quarantined"])(
  "native session factory accepts vault bootstrap only for %s",
  async (status) => {
    const previousUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
    const originalFetch = globalThis.fetch;
    process.env.EXPO_PUBLIC_CONVEX_URL =
      "https://native-bootstrap.convex.cloud";
    const id = `client_BOOTSTRAP${++bootstrapFixture}`;
    const claims = {
      iss: `https://api.workos.com/user_management/${id}`,
      sub: "user_NATIVE",
      sid: "session_NATIVE",
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const token = `header.${btoa(JSON.stringify(claims))}.signature`;
    let bootstrapped = false;
    globalThis.fetch = ((input, init) => {
      if (String(input).includes("api.workos.com")) {
        return Promise.resolve(
          Response.json({
            access_token: token,
            refresh_token: "refresh",
            user: {
              id: "user_NATIVE",
              email: "test@example.com",
              email_verified: true,
              external_id: null,
            },
          })
        );
      }
      expect(String(input)).toBe(
        "https://native-bootstrap.convex.cloud/api/mutation"
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${token}`
      );
      expect(JSON.parse(String(init?.body)).path).toBe(
        "workosBootstrap:ensureUser"
      );
      expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(false);
      bootstrapped = true;
      const value =
        status === "ok"
          ? { status, teakUserId: "permanent-vault" }
          : { status, reason: "identity_conflict" };
      return Promise.resolve(Response.json({ status: "success", value }));
    }) as typeof fetch;
    try {
      const session = getWorkosSession(id);
      const login = session.exchangeCode("code", "v".repeat(43));
      if (status === "ok") {
        expect(await login).toBe(token);
        expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(true);
      } else {
        await expect(login).rejects.toThrow();
        expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(false);
        expect(session.getSnapshot().user).toBeNull();
      }
      expect(bootstrapped).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CONVEX_URL;
      } else {
        process.env.EXPO_PUBLIC_CONVEX_URL = previousUrl;
      }
    }
  }
);
