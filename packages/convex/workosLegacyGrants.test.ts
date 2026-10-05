/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pins = {
  environmentId: "environment_expected",
  clientId: "client_expected",
  apiKeyFingerprint:
    "0cd3cf5f74c92c94559c4397065417ee80f45c5115d28889b9872049ea5533aa",
};
type Held = typeof pins & { holder: string; generation: number };
const scan = makeFunctionReference<
  "mutation",
  Held & { cursor: string | null },
  {
    deleted: number;
    scanned: number;
    done: boolean;
    cursor: string | null;
    blockedIds: string[];
  }
>("migration/workosCutover:revokePendingGrantsPage");
const native = makeFunctionReference<
  "mutation",
  Held,
  { deleted: number; done: boolean }
>("migration/workosCutover:revokeNativeCodesPage");
beforeEach(() => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_API_KEY", "test-workos-reconciliation-key");
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}
const hold = (t: ReturnType<typeof setup>) =>
  t.mutation(internal.migration.workosImportLease.establishQuiescence, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "d".repeat(64),
  });
const codeValue = (requireConsent = false) => ({
  clientId: "teak-cli",
  userId: "permanent",
  redirectURI: "http://127.0.0.1:14210/callback",
  scope: ["openid", "profile", "email", "offline_access"],
  authTime: 1,
  requireConsent,
  state: null,
  codeChallenge: "a".repeat(43),
  codeChallengeMethod: "s256",
});
const codeId = () => crypto.randomUUID().replaceAll("-", "");
const row = (identifier: string, value: unknown) => ({
  identifier,
  value: typeof value === "string" ? value : JSON.stringify(value),
  expiresAt: Date.now() + 600_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
const insert = (t: ReturnType<typeof setup>, data: ReturnType<typeof row>) =>
  t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "verification", data },
    })
  );
const rows = (t: ReturnType<typeof setup>) =>
  t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "verification",
      paginationOpts: { cursor: null, numItems: 100 },
    })
  );
// Failure modes: cursor deletion skips grants after unrelated rows; malformed
// potential grant mistaken for safe data; deleting reset/replay/email records;
// admitted action inserts a new code after drain; native tickets survive rollback.
test("selective cursor scan deletes consent/code/social grants beyond unrelated pages and retains reset/replay/email records", async () => {
  const t = setup();
  for (let index = 0; index < 25; index++) {
    await insert(t, row(`reset-password:${index}`, "permanent"));
  }
  await insert(
    t,
    row(`teak-oauth-used-refresh:${"a".repeat(64)}`, {
      clientId: "teak-cli",
      userId: "permanent",
    })
  );
  await insert(t, row("email-verification:retained", "signed-email-token"));
  for (let index = 0; index < 25; index++) {
    await insert(t, row(codeId(), codeValue(index % 2 === 0)));
  }
  const socialId = `-${"a".repeat(30)}_`;
  await insert(
    t,
    row(socialId, {
      callbackURL: "http://localhost:3000",
      codeVerifier: "a".repeat(128),
      expiresAt: Date.now() + 600_000,
      oauthState: socialId,
      link: { email: "owner@example.com", userId: "permanent" },
    })
  );
  const held = { ...pins, ...(await hold(t)) };
  await expect(t.mutation(scan, { ...held, cursor: null })).rejects.toThrow(
    "WorkOS primary"
  );
  vi.stubEnv("AUTH_PRIMARY", "workos");
  let cursor: string | null = null,
    deleted = 0,
    done = false;
  for (let page = 0; page < 10; page++) {
    const result: {
      deleted: number;
      scanned: number;
      done: boolean;
      cursor: string | null;
      blockedIds: string[];
    } = await t.mutation(scan, { ...held, cursor });
    expect(result.blockedIds).toEqual([]);
    deleted += result.deleted;
    if (result.done) {
      done = true;
      break;
    }
    expect(result.cursor).not.toBe(cursor);
    cursor = result.cursor;
  }
  expect(done).toBe(true);
  expect(deleted).toBe(26);
  expect((await rows(t)).page).toHaveLength(27);
  expect(
    (await rows(t)).page.every(
      (value: { identifier?: string }) =>
        typeof value.identifier === "string" &&
        (value.identifier.startsWith("reset-password:") ||
          value.identifier.startsWith("teak-oauth-used-refresh:") ||
          value.identifier.startsWith("email-verification:"))
    )
  ).toBe(true);
});
test("ambiguous grant payloads remain untouched and block completion without exposing their token values", async () => {
  const t = setup();
  const badValues = [
    "not-json",
    { ...codeValue(), scope: "openid" },
    { ...codeValue(), extra: "unknown" },
    { ...codeValue(), authTime: -1 },
    { ...codeValue(), userId: 7 },
    { ...codeValue(), codeChallengeMethod: "unsafe" },
    { ...codeValue(), codeChallengeMethod: "S256" },
    {
      callbackURL: "http://localhost:3000",
      codeVerifier: "a".repeat(128),
      expiresAt: Date.now(),
      oauthState: "b".repeat(32),
    },
    "x".repeat(32 * 1024 + 1),
  ];
  for (const value of badValues) {
    await insert(t, row(codeId(), value));
  }
  await insert(t, row("invalid-identifier", codeValue()));
  await insert(t, row(`-${"o".repeat(30)}_`, codeValue()));
  await insert(
    t,
    row(`_${"s".repeat(30)}-`, {
      callbackURL: "http://localhost:3000",
      codeVerifier: "v".repeat(128),
      expiresAt: Date.now() + 600_000,
      oauthState: `-${"s".repeat(30)}_`,
    })
  );
  await insert(t, row(codeId(), codeValue()));
  const held = { ...pins, ...(await hold(t)) };
  vi.stubEnv("AUTH_PRIMARY", "workos");
  const result = await t.mutation(scan, { ...held, cursor: null });
  expect(result.deleted).toBe(1);
  expect(result.blockedIds).toHaveLength(12);
  expect(JSON.stringify(result)).not.toContain("codeVerifier");
  expect((await rows(t)).page).toHaveLength(12);
});
test("verification triggers deny late consent/code/social insertion and conversion after held barrier while unrelated records work", async () => {
  const t = setup();
  let admitted:
    | ReturnType<ReturnType<typeof authComponent.adapter>>
    | undefined;
  await t.run((ctx) => {
    admitted = authComponent.adapter(ctx)(createAuth(ctx).options);
    return Promise.resolve(null);
  });
  const getAdmitted = () => {
    if (!admitted) {
      throw new Error("Missing adapter");
    }
    return admitted;
  };
  const create = (identifier: string, value: unknown) =>
    t.run(() =>
      getAdmitted().create({
        model: "verification",
        data: {
          ...row(identifier, value),
          expiresAt: new Date(Date.now() + 600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    );
  const existing = await create(codeId(), codeValue(true));
  const unrelated = await create("email-verification:retained", "signed-token");
  await hold(t);
  await expect(create(codeId(), codeValue())).rejects.toThrow(
    "credential writes are stopped"
  );
  const id = `_${"b".repeat(30)}-`;
  await expect(
    create(id, {
      callbackURL: "http://localhost:3000",
      codeVerifier: "a".repeat(128),
      expiresAt: Date.now() + 600_000,
      oauthState: id,
    })
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "verification",
        where: [{ field: "id", value: existing.id }],
        update: {
          identifier: "email-verification:converted",
          value: "not-a-grant",
        },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    t.run(() =>
      getAdmitted().update({
        model: "verification",
        where: [{ field: "id", value: unrelated.id }],
        update: { identifier: codeId(), value: JSON.stringify(codeValue()) },
      })
    )
  ).rejects.toThrow("credential writes are stopped");
  await expect(
    create(codeId(), { ...codeValue(), scope: "bad" })
  ).rejects.toThrow("Ambiguous legacy grant");
  expect(await create("reset-password:retained", "permanent")).toHaveProperty(
    "id"
  );
  expect(
    await create(`teak-oauth-used-refresh:${"b".repeat(64)}`, {
      clientId: "teak-cli",
      userId: "permanent",
    })
  ).toHaveProperty("id");
  expect((await rows(t)).page).toHaveLength(4);
});
test("bounded native ticket drain removes all pre-cutover intents without relying on expiration", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 25; index++) {
      await ctx.db.insert("nativeAuthCodes", {
        sessionId: "legacy-session",
        userId: "permanent",
        deviceId: `device-${index}`,
        codeChallenge: "a".repeat(43),
        state: "intent-state",
        surface: "desktop",
        expiresAt: Date.now() + 600_000,
        createdAt: Date.now(),
      });
    }
  });
  const held = { ...pins, ...(await hold(t)) };
  vi.stubEnv("AUTH_PRIMARY", "workos");
  expect(await t.mutation(native, held)).toEqual({ deleted: 20, done: false });
  expect(await t.mutation(native, held)).toEqual({ deleted: 5, done: false });
  expect(await t.mutation(native, held)).toEqual({ deleted: 0, done: true });
  expect(
    await t.run((ctx) => ctx.db.query("nativeAuthCodes").take(20))
  ).toHaveLength(0);
});

test("native creation rolls back at the barrier and drained codes cannot mint after barrier release and importer reacquisition", async () => {
  const t = setup();
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: "permanent",
          token: crypto.randomUUID(),
          expiresAt: Date.now() + 600_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
  );
  const signed = t.withIdentity({
    issuer: process.env.CONVEX_SITE_URL!,
    subject: "permanent",
    sessionId: session._id,
  });
  const verifier = "a".repeat(43);
  const challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      )
    )
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const args = {
    deviceId: "desktop-device-123456",
    state: "state_123456789012",
    codeChallenge: challenge,
    surface: "desktop" as const,
  };
  await signed.mutation(api.authNative.createNativeAuthCode, args);
  const held = { ...pins, ...(await hold(t)) };
  await expect(
    signed.mutation(api.authNative.createNativeAuthCode, args)
  ).rejects.toThrow("credential writes are stopped");
  expect(
    await t.run((ctx) => ctx.db.query("nativeAuthCodes").collect())
  ).toHaveLength(1);
  vi.stubEnv("AUTH_PRIMARY", "workos");
  expect(await t.mutation(native, held)).toEqual({ deleted: 1, done: false });
  expect(await t.mutation(native, held)).toEqual({ deleted: 0, done: true });
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  await t.mutation(
    internal.migration.workosImportLease.releaseQuiescence,
    held
  );
  await t.mutation(internal.migration.workosImportLease.acquire, {
    ...pins,
    holder: crypto.randomUUID(),
    runId: "e".repeat(64),
  });
  await expect(t.mutation(native, held)).rejects.toThrow();
  expect(
    await t.mutation(internal.authNative.consumeNativeAuthByState, {
      deviceId: args.deviceId,
      state: args.state,
      codeVerifier: verifier,
    })
  ).toBeNull();
});

test("installed social-state alphabets and lowercase PKCE codes remain admitted before the barrier and drain afterward", async () => {
  const t = setup();
  const identifiers = [`-${"g".repeat(30)}_`, `_${"a".repeat(30)}-`];
  for (const identifier of identifiers) {
    await t.run(async (ctx) => {
      const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
      return await adapter.create({
        model: "verification",
        data: {
          identifier,
          value: JSON.stringify({
            callbackURL: "http://localhost:3000",
            codeVerifier: "v".repeat(128),
            expiresAt: Date.now() + 600_000,
            oauthState: identifier,
            errorURL: "http://localhost:3000/error",
            newUserURL: "http://localhost:3000/welcome",
            requestSignUp: false,
          }),
          expiresAt: new Date(Date.now() + 600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }
  await t.run(async (ctx) => {
    const adapter = authComponent.adapter(ctx)(createAuth(ctx).options);
    return await adapter.create({
      model: "verification",
      data: {
        identifier: codeId(),
        value: JSON.stringify(codeValue()),
        expiresAt: new Date(Date.now() + 600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });
  expect((await rows(t)).page).toHaveLength(3);
  const held = { ...pins, ...(await hold(t)) };
  vi.stubEnv("AUTH_PRIMARY", "workos");
  const drained = await t.mutation(scan, { ...held, cursor: null });
  expect(drained.blockedIds).toEqual([]);
  expect(drained.deleted).toBe(3);
  expect(drained.done).toBe(true);
  expect((await rows(t)).page).toHaveLength(0);
});
