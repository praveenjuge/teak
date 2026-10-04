/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TEST_APPLE_PRIVATE_KEY } from "./__tests__/helpers/appleAuth.test-utils";
import { api, components, internal } from "./_generated/api";
import { createAuth } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};

beforeEach(() => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("E2E_EMAIL_DOMAIN", "e2e.invalid");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("client discovery is registered at the public GET and OPTIONS routes", async () => {
  const t = setup();
  const response = await t.fetch("/.well-known/teak-oauth-clients.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(await response.json()).toEqual({
    primary: "betterauth",
    issuer: "http://localhost:3000",
    clients: {
      cli: "teak-cli",
      raycast: "teak-raycast",
      chrome: "teak-chrome",
      firefox: "teak-firefox",
      safari: "teak-safari",
    },
  });
  const preflight = await t.fetch("/.well-known/teak-oauth-clients.json", {
    method: "OPTIONS",
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain(
    "GET"
  );
});

test.each([undefined, "environment_other"])(
  "readiness endpoints expose nothing outside the managed dev environment (%s)",
  async (environment) => {
    vi.stubEnv("WORKOS_ENVIRONMENT_ID", environment);
    const t = setup().withIdentity({
      subject: "user_readiness",
      issuer:
        "https://api.workos.com/user_management/client_01KBYSVNVDV2G39REZFGF0K7GD",
      sid: "session_readiness",
    });
    expect(await t.query(api.migration.readiness.identity, {})).toBeNull();
    const response = await t.fetch("/migration/connect-readiness.json");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  }
);

test("readiness identity accepts only the dev issuer and an AuthKit session", async () => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_01KBYSVN9RVQ1JXACG3MDMQZGA");
  const t = setup();
  const identity = {
    subject: "user_readiness",
    issuer:
      "https://api.workos.com/user_management/client_01KBYSVNVDV2G39REZFGF0K7GD",
    sid: "session_readiness",
    external_id: "original_teak_id",
    email_verified: true,
  };
  expect(await t.query(api.migration.readiness.identity, {})).toBeNull();
  for (const invalid of [
    { ...identity, issuer: "https://attacker.example" },
    { ...identity, sid: "oauth_access_token" },
    { ...identity, sid: undefined },
  ]) {
    expect(
      await t.withIdentity(invalid).query(api.migration.readiness.identity, {})
    ).toBeNull();
  }
  expect(
    await t.withIdentity(identity).query(api.migration.readiness.identity, {})
  ).toEqual({
    subject: identity.subject,
    issuer: identity.issuer,
    sid: identity.sid,
    externalId: identity.external_id,
    emailVerified: true,
  });
});

test.each([
  "new@example.com",
  "e2e-run@e2e.invalid.attacker.com",
  "ordinary@e2e.invalid",
])("creation backstop rejects %s without persisting a user", async (email) => {
  const t = setup();
  await expect(
    t.run(async (ctx) => {
      const auth = await createAuth(ctx).$context;
      return auth.internalAdapter.createUser({ email, name: "Frozen sign-up" });
    })
  ).rejects.toThrow("New sign-ups are paused while we upgrade sign-in");
  const result = await t.query(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(result.page).toHaveLength(0);
});

test("auth mode reports the active freeze without changing primary provider", async () => {
  const t = setup();
  expect(await t.query(api.auth.getAuthMode, {})).toEqual({
    primary: "betterauth",
    signupsDisabled: true,
    accountChangesPaused: false,
  });
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  expect((await t.query(api.auth.getAuthMode, {})).signupsDisabled).toBe(false);
});

test("the configured E2E account can still provision during the freeze", async () => {
  const t = setup();
  const user = await t.run(async (ctx) => {
    const auth = await createAuth(ctx).$context;
    return auth.internalAdapter.createUser({
      email: "e2e-freeze-proof@e2e.invalid",
      name: "E2E freeze proof",
    });
  });
  expect(user.email).toBe("e2e-freeze-proof@e2e.invalid");
  const result = await t.query(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(result.page).toHaveLength(1);
});

test("existing password accounts still sign in during the freeze", async () => {
  const t = setup();
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  await t.run(async (ctx) => {
    await createAuth(ctx).api.signUpEmail({
      body: {
        email: "existing@example.com",
        name: "Existing account",
        password: "Existing-proof-password-123!",
      },
    });
  });
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  const result = await t.run((ctx) =>
    createAuth(ctx).api.signInEmail({
      body: {
        email: "existing@example.com",
        password: "Existing-proof-password-123!",
      },
    })
  );
  expect(result.user.email).toBe("existing@example.com");
  expect(result.token).toBeTypeOf("string");
});

test("email sign-up rejects new accounts before creating any rows", async () => {
  const t = setup();
  await expect(
    t.run((ctx) =>
      createAuth(ctx).api.signUpEmail({
        body: {
          email: "new@example.com",
          name: "New account",
          password: "New-proof-password-123!",
        },
      })
    )
  ).rejects.toThrow("Email and password sign up is not enabled");
});

test.each(["google", "apple"] as const)(
  "%s native ID-token sign-up cannot bypass the freeze with requestSignUp",
  async (provider) => {
    const t = setup();
    vi.stubEnv("GOOGLE_CLIENT_ID", "freeze-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-only");
    vi.stubEnv("APPLE_CLIENT_ID", "freeze-apple");
    vi.stubEnv("APPLE_KEY_ID", "test-only");
    vi.stubEnv("APPLE_TEAM_ID", "test-only");
    vi.stubEnv("APPLE_PRIVATE_KEY", TEST_APPLE_PRIVATE_KEY);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "freeze-proof",
      alg: "RS256",
    };
    vi.stubGlobal("fetch", (url: string) => {
      if (
        ![
          "https://www.googleapis.com/oauth2/v3/certs",
          "https://appleid.apple.com/auth/keys",
        ].includes(String(url))
      ) {
        throw new Error("Unexpected provider network request");
      }
      return Promise.resolve(Response.json({ keys: [jwk] }));
    });
    const token = await new SignJWT({
      email: "new-social@example.com",
      email_verified: true,
      name: "New social account",
    })
      .setProtectedHeader({ alg: "RS256", kid: "freeze-proof" })
      .setIssuer(
        provider === "google"
          ? "https://accounts.google.com"
          : "https://appleid.apple.com"
      )
      .setAudience(`freeze-${provider}`)
      .setSubject(`new-${provider}-subject`)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      t.run((ctx) =>
        createAuth(ctx).api.signInSocial({
          body: { provider, idToken: { token }, requestSignUp: true },
        })
      )
    ).rejects.toThrow("New sign-ups are paused while we upgrade sign-in");
    const result = await t.query(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page).toHaveLength(0);
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    const existing = await t.run(async (ctx) => {
      const auth = await createAuth(ctx).$context;
      return auth.internalAdapter.createUser({
        email: "new-social@example.com",
        emailVerified: true,
        name: "Existing social account",
      });
    });
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const signedIn = await t.run((ctx) =>
      createAuth(ctx).api.signInSocial({
        body: { provider, idToken: { token } },
      })
    );
    if (!("user" in signedIn)) {
      throw new Error("Native provider sign-in unexpectedly redirected");
    }
    expect(signedIn.user.id).toBe(existing.id);
    expect(signedIn.token).toBeTypeOf("string");
  }
);

test("the backup exports credential rows without changing the account", async () => {
  const t = setup();
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  const created = await t.run((ctx) =>
    createAuth(ctx).api.signUpEmail({
      body: {
        email: "backup-proof@example.com",
        password: "Backup proof password",
        name: "Backup proof",
      },
    })
  );
  const users = await t.action(internal.migration.exportBetterAuth.page, {
    model: "user",
    cursor: null,
  });
  const accounts = await t.action(internal.migration.exportBetterAuth.page, {
    model: "account",
    cursor: null,
  });
  expect(users.page).toHaveLength(1);
  expect(users.page[0]._id).toBe(created.user.id);
  expect(accounts.page).toHaveLength(1);
  expect(accounts.page[0].userId).toBe(created.user.id);
  expect(accounts.page[0].password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  expect(users.isDone).toBe(true);
  for (const model of [
    "session",
    "verification",
    "oauthApplication",
    "oauthAccessToken",
    "oauthConsent",
    "jwks",
  ] as const) {
    const exported = await t.action(internal.migration.exportBetterAuth.page, {
      model,
      cursor: null,
    });
    const original = await t.query(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(exported.page).toEqual(original.page);
    expect(exported.isDone).toBe(true);
  }
  const originalUsers = await t.query(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(users.page).toEqual(originalUsers.page);
});

test("the backup resumes across user pages without omissions or duplicates", async () => {
  const t = setup();
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  const ids = await t.run(async (ctx) => {
    const auth = await createAuth(ctx).$context;
    const created: string[] = [];
    for (let index = 0; index < 101; index += 1) {
      const user = await auth.internalAdapter.createUser({
        email: `backup-${index}@example.com`,
        name: "Paged backup",
      });
      created.push(user.id);
    }
    return created;
  });
  const first = await t.action(internal.migration.exportBetterAuth.page, {
    model: "user",
    cursor: null,
  });
  expect(first.page).toHaveLength(100);
  expect(first.isDone).toBe(false);
  const second = await t.action(internal.migration.exportBetterAuth.page, {
    model: "user",
    cursor: first.continueCursor,
  });
  expect(second.page).toHaveLength(1);
  expect(second.isDone).toBe(true);
  expect(
    [...first.page, ...second.page].map((user) => user._id).sort()
  ).toEqual(ids.sort());
});
