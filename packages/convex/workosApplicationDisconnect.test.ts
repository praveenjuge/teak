/// <reference types="vite/client" />

import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedComponentUser } from "./__tests__/helpers/workosOwner.test-utils";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const principal = {
  workosUserId: "user_ONE",
  clientId: "client_ONE",
  consentId: "app_consent_ONE",
  externalId: "owner",
};
beforeEach(() => {
  vi.stubEnv("WORKOS_API_KEY", "sk_test");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_TEST");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_ENV");
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://disconnect-tests.authkit.app");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  await seedComponentUser(t, {
    id: principal.workosUserId,
    email: "owner@example.test",
    externalId: "owner",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner",
      workosUserId: principal.workosUserId,
      email: "owner@example.test",
      emailVerified: true,
    });
    await ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: principal.consentId,
      userId: "owner",
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
  });
  return t;
}
function provider(deleteResult: () => Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "DELETE") {
      return deleteResult();
    }
    expect(url.origin).toBe("https://api.workos.com");
    return Promise.resolve(
      Response.json({
        data: [
          { application: { id: "connect_app_ONE", client_id: "client_ONE" } },
          {
            application: { id: "connect_app_OTHER", client_id: "client_OTHER" },
          },
        ],
        list_metadata: {},
      })
    );
  });
}
const run = (t: Awaited<ReturnType<typeof setup>>, args = principal) =>
  t.action(internal.workosApplicationDisconnect.run, args);
const authorize = (t: Awaited<ReturnType<typeof setup>>, consentId: string) =>
  t.mutation(internal.workosConsents.authorizeConnectConsent, {
    ...principal,
    consentId,
  });
const consents = (t: Awaited<ReturnType<typeof setup>>) =>
  t.run((ctx) => ctx.db.query("workosConsents").take(10));
const deletes = (fetcher: ReturnType<typeof provider>) =>
  fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE");

test("disconnect deletes only this app's grant and denies its consent at once", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await run(t)).toBe(204);
  expect(deletes(fetcher)).toHaveLength(1);
  expect(String(deletes(fetcher)[0][0])).toContain("/connect_app_ONE");
  expect(await authorize(t, principal.consentId)).toMatchObject({
    status: "denied",
    reason: "revoked_consent",
  });
});

test("a repeated disconnect is a no-op that never deletes twice", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await run(t)).toBe(204);
  expect(await run(t)).toBe(204);
  expect(deletes(fetcher)).toHaveLength(1);
});

test("earlier consents for the app are revoked; other apps and later grants are not", async () => {
  const t = await setup();
  await t.run(async (ctx) => {
    for (const [consentId, clientId] of [
      ["app_consent_SIBLING", principal.clientId],
      ["app_consent_OTHER", "client_OTHER"],
    ]) {
      await ctx.db.insert("workosConsents", {
        workosUserId: principal.workosUserId,
        clientId,
        consentId,
        userId: "owner",
        firstSeenAt: 1,
        lastSeenAt: 1,
      });
    }
    await ctx.db.insert("workosConsents", {
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      consentId: "app_consent_LATER",
      userId: "owner",
      firstSeenAt: Date.now() + 60_000,
      lastSeenAt: Date.now() + 60_000,
    });
  });
  vi.stubGlobal(
    "fetch",
    provider(async () => new Response(null, { status: 204 }))
  );
  expect(await run(t)).toBe(204);
  const byId = new Map((await consents(t)).map((row) => [row.consentId, row]));
  expect(byId.get("app_consent_SIBLING")?.revokedAt).toBeTypeOf("number");
  expect(byId.get("app_consent_OTHER")?.revokedAt).toBeUndefined();
  expect(byId.get("app_consent_LATER")?.revokedAt).toBeUndefined();
});

test.each([400, 401, 403, 429, 500, 503])(
  "a provider %s leaves access untouched so the user can retry",
  async (status) => {
    const t = await setup();
    vi.stubGlobal(
      "fetch",
      provider(async () => new Response(null, { status }))
    );
    expect(await run(t)).toBe(503);
    expect((await consents(t))[0].revokedAt).toBeUndefined();
    expect(await authorize(t, principal.consentId)).toMatchObject({
      status: "ok",
    });
  }
);

test("a lost DELETE response leaves access untouched", async () => {
  const t = await setup();
  vi.stubGlobal(
    "fetch",
    provider(() => Promise.reject(new Error("lost acknowledgement")))
  );
  expect(await run(t)).toBe(503);
  expect((await consents(t))[0].revokedAt).toBeUndefined();
});

test("an app already gone at WorkOS (absent or 404) still disconnects", async () => {
  for (const fetcher of [
    vi.fn(() =>
      Promise.resolve(Response.json({ data: [], list_metadata: {} }))
    ),
    provider(async () => new Response(null, { status: 404 })),
  ]) {
    const t = await setup();
    vi.stubGlobal("fetch", fetcher);
    expect(await run(t)).toBe(204);
    expect((await consents(t))[0].revokedAt).toBeTypeOf("number");
  }
});

test("an expired token can only replay a finished disconnect", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const expired = {
    ...principal,
    tokenExpiresAt: Math.floor(Date.now() / 1000) - 10,
  };
  expect(await run(t, expired)).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await run(t)).toBe(204);
  expect(await run(t, expired)).toBe(204);
  expect(deletes(fetcher)).toHaveLength(1);
});

test("a consent bound to another owner or app cannot disconnect", async () => {
  const t = await setup();
  const fetcher = provider(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await run(t, { ...principal, externalId: "someone-else" })).toBe(401);
  expect(await run(t, { ...principal, clientId: "client_OTHER" })).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});

test("an unfinished disconnect from the previous flow denies until a new one settles it", async () => {
  const t = await setup();
  await t.run((ctx) =>
    ctx.db.insert("workosApplicationDisconnects", {
      operationId: "op_OLD",
      userId: "owner",
      workosUserId: principal.workosUserId,
      clientId: principal.clientId,
      triggerConsentId: "app_consent_OLD",
      environmentId: "environment_TEST",
      authKitClientId: "client_ENV",
      authKitDomain: "https://disconnect-tests.authkit.app",
      credentialFingerprint: "fingerprint",
      state: "unknown",
      startedAt: 1,
    })
  );
  expect(await authorize(t, principal.consentId)).toMatchObject({
    status: "denied",
    reason: "application_disconnected",
  });
  vi.stubGlobal(
    "fetch",
    provider(async () => new Response(null, { status: 204 }))
  );
  expect(await run(t)).toBe(204);
  const fence = await t.run((ctx) =>
    ctx.db.query("workosApplicationDisconnects").first()
  );
  expect(fence?.state).toBe("completed");
  expect(await authorize(t, "app_consent_NEW")).toMatchObject({
    status: "ok",
    teakUserId: "owner",
  });
});
