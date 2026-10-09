import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type SessionStorage, WorkosSession } from "../../lib/workos-session";
import {
  secureStoreData as nativeCredentials,
  secureStoreMock,
} from "../secureStoreMock";

// Expo AuthSession and the system browser are hardware boundaries. The actual
// session manager and exchange are exercised; state mismatch/cancel/error must
// never reach the token endpoint, and sign-out invalidates an open browser flow.
let result: Record<string, unknown>;
let config: Record<string, unknown>;
let promptOptions: unknown;
let prompt: (() => Promise<unknown>) | undefined;
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
    promptAsync(
      discovery: { authorizationEndpoint: string },
      options: unknown
    ) {
      promptOptions = options;
      expect(discovery.authorizationEndpoint).toBe(
        "https://api.workos.com/user_management/authorize"
      );
      return prompt ? prompt() : Promise.resolve(result);
    }
  },
}));
mock.module("expo-secure-store", () => secureStoreMock);
mock.module("expo-web-browser", () => ({
  maybeCompleteAuthSession: () => {},
}));
const { signInWithWorkos, WORKOS_REDIRECT_URI } = await import(
  "../../lib/workos-native-auth"
);
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
        refresh_token: crypto.randomUUID(),
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
  nativeCredentials.clear();
  mock.module("expo-secure-store", () => secureStoreMock);
  result = {
    type: "success",
    params: { state: "expected-state", code: "code" },
  };
  prompt = undefined;
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
      // No AuthKit cookie outlives sign-in, so a revoked session stays out.
      // Apple's form POST callback needs the shared browser session.
      expect(promptOptions).toEqual({
        preferEphemeralSession: provider !== "AppleOAuth",
      });
      expect(s.session.getSnapshot().user?.teakUserId).toBe("permanent-vault");
      expect(s.count()).toBe(1);
    }
  );
  test.each(["sign-in", "sign-up"] as const)(
    "opens AuthKit on its %s screen",
    async (screenHint: "sign-in" | "sign-up") => {
      const s = setup();
      expect(await signInWithWorkos(s.session, "authkit", screenHint)).toBe(
        true
      );
      expect(config.extraParams).toEqual({
        provider: "authkit",
        screen_hint: screenHint,
      });
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
  test("declining at the provider does not exchange a code", async () => {
    const s = setup();
    result = {
      type: "error",
      params: { state: "expected-state", error: "access_denied" },
    };
    expect(await signInWithWorkos(s.session, "AppleOAuth")).toBe(false);
    expect(s.count()).toBe(0);
  });
  test.each([
    { type: "success", params: { state: "wrong-state", code: "code" } },
    { type: "success", params: { state: "expected-state" } },
    { type: "error", params: { state: "expected-state", code: "code" } },
    {
      type: "error",
      params: { state: "expected-state", error: "server_error" },
    },
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
});

let bootstrapFixture = 0;
test.each([
  "ok",
  "verify_email",
  "frozen",
  "quarantined",
  "invalid_origin",
  "profile_pending",
])(
  "native session factory accepts vault bootstrap only for %s",
  async (status) => {
    const previousUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
    const originalFetch = globalThis.fetch;
    process.env.EXPO_PUBLIC_CONVEX_URL =
      status === "invalid_origin"
        ? "https://untrusted.example"
        : "https://native-bootstrap.convex.cloud";
    const id = `client_BOOTSTRAP${++bootstrapFixture}`;
    const claims = {
      iss: `https://api.workos.com/user_management/${id}`,
      sub: "user_NATIVE",
      sid: "session_NATIVE",
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const token = `header.${btoa(JSON.stringify(claims))}.signature`;
    let bootstrapped = false;
    let bootstraps = 0;
    globalThis.fetch = ((input, init) => {
      if (
        String(input) === "https://api.workos.com/user_management/authenticate"
      ) {
        return Promise.resolve(
          Response.json({
            access_token: token,
            refresh_token: crypto.randomUUID(),
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
      bootstraps += 1;
      // A new user's profile is still syncing on the first attempt.
      let value: Record<string, string> = {
        status,
        reason: "identity_conflict",
      };
      if (status === "profile_pending") {
        value = { status: "quarantined", reason: status };
      }
      if (status === "ok" || (status === "profile_pending" && bootstraps > 1)) {
        value = { status: "ok", teakUserId: "permanent-vault" };
      }
      return Promise.resolve(Response.json({ status: "success", value }));
    }) as typeof fetch;
    try {
      const { getWorkosSession: nativeSession } = await import(
        `../../lib/workos-native-auth?bootstrap=${crypto.randomUUID()}`
      );
      const session = nativeSession(id);
      const login = session.exchangeCode("code", "v".repeat(43));
      if (status === "invalid_origin") {
        await expect(login).rejects.toThrow("Invalid EXPO_PUBLIC_CONVEX_URL");
        expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(false);
        expect(session.getSnapshot().user).toBeNull();
      } else if (status === "ok" || status === "profile_pending") {
        expect(await login).toBe(token);
        expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(true);
        expect(bootstraps).toBe(status === "ok" ? 1 : 2);
      } else {
        await expect(login).rejects.toThrow();
        expect(nativeCredentials.has(`teak.authkit.${id}`)).toBe(false);
        expect(session.getSnapshot().user).toBeNull();
      }
      expect(bootstrapped).toBe(status !== "invalid_origin");
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
